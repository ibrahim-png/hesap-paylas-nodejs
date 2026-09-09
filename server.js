require("dotenv").config();

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL ortam değişkeni zorunludur.");
  process.exit(1);
}

const app = express();
const port = Number(process.env.PORT) || 3000;
const sessionCookie = "hesap_session";
const sessionDays = 30;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor/tesseract", express.static(path.join(__dirname, "node_modules", "tesseract.js", "dist")));

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.randomBytes(7), (byte) => alphabet[byte % alphabet.length]).join("");
}

function normalizeName(name) {
  return name.trim().normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function normalizeFullName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 100);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLocaleLowerCase("en-US").slice(0, 254);
}

function maskEmail(email) {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}${"*".repeat(Math.max(3, Math.min(8, local.length - 2)))}@${domain}`;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const derived = crypto.scryptSync(password, salt, 64).toString("base64url");
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, storedHash) {
  try {
    const [algorithm, salt, expected] = String(storedHash).split("$");
    if (algorithm !== "scrypt" || !salt || !expected) return false;
    const actualBuffer = crypto.scryptSync(password, salt, 64);
    const expectedBuffer = Buffer.from(expected, "base64url");
    return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

function readCookie(request, name) {
  const cookies = String(request.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === name) return decodeURIComponent(cookie.slice(separator + 1).trim());
  }
  return null;
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(request, response, token) {
  const secure = request.secure || process.env.NODE_ENV === "production";
  response.setHeader("Set-Cookie", `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionDays * 86400}${secure ? "; Secure" : ""}`);
}

function clearSessionCookie(request, response) {
  const secure = request.secure || process.env.NODE_ENV === "production";
  response.setHeader("Set-Cookie", `${sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`);
}

async function createSession(request, response, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '30 days')",
    [tokenHash(token), userId],
  );
  setSessionCookie(request, response, token);
}

function safeError(response, error, message) {
  console.error(message, error);
  response.status(500).json({ error: message });
}

async function authRequired(request, response, next) {
  try {
    const token = readCookie(request, sessionCookie);
    if (!token) return response.status(401).json({ error: "Lütfen giriş yapın." });
    const hash = tokenHash(token);
    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name AS "fullName"
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
      [hash],
    );
    if (!result.rows[0]) {
      clearSessionCookie(request, response);
      return response.status(401).json({ error: "Oturumunuz sona erdi. Lütfen tekrar giriş yapın." });
    }
    request.user = result.rows[0];
    request.sessionHash = hash;
    next();
  } catch (error) {
    safeError(response, error, "Oturum doğrulanamadı.");
  }
}

app.get("/api/health", async (_request, response) => {
  try {
    await pool.query("SELECT 1");
    response.json({ ok: true });
  } catch {
    response.status(503).json({ ok: false });
  }
});

app.post("/api/auth/register", async (request, response) => {
  const fullName = normalizeFullName(request.body?.fullName);
  const email = normalizeEmail(request.body?.email);
  const password = String(request.body?.password || "");
  if (fullName.split(" ").filter(Boolean).length < 2) return response.status(400).json({ error: "Adınızı ve soyadınızı yazın." });
  if (!/^[^\s@]+@gmail\.com$/i.test(email)) return response.status(400).json({ error: "Geçerli bir Gmail adresi yazın." });
  if (password.length < 8 || password.length > 128) return response.status(400).json({ error: "Şifre en az 8 karakter olmalıdır." });
  try {
    const id = crypto.randomUUID();
    const result = await pool.query(
      `INSERT INTO users (id, email, full_name, normalized_name, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, full_name AS "fullName"`,
      [id, email, fullName, normalizeName(fullName), hashPassword(password)],
    );
    await createSession(request, response, id);
    response.status(201).json({ user: result.rows[0] });
  } catch (error) {
    if (error.code === "23505") return response.status(409).json({ error: "Bu Gmail adresiyle daha önce üye olunmuş." });
    safeError(response, error, "Üyelik oluşturulamadı.");
  }
});

app.post("/api/auth/login", async (request, response) => {
  const email = normalizeEmail(request.body?.email);
  const password = String(request.body?.password || "");
  try {
    const result = await pool.query(
      'SELECT id, email, full_name AS "fullName", password_hash AS "passwordHash" FROM users WHERE email = $1 LIMIT 1',
      [email],
    );
    const user = result.rows[0];
    if (!user || !verifyPassword(password, user.passwordHash)) return response.status(401).json({ error: "Gmail veya şifre hatalı." });
    await createSession(request, response, user.id);
    delete user.passwordHash;
    response.json({ user });
  } catch (error) {
    safeError(response, error, "Giriş yapılamadı.");
  }
});

app.get("/api/auth/me", authRequired, (request, response) => response.json({ user: request.user }));

app.post("/api/auth/logout", authRequired, async (request, response) => {
  try {
    await pool.query("DELETE FROM user_sessions WHERE token_hash = $1", [request.sessionHash]);
    clearSessionCookie(request, response);
    response.json({ ok: true });
  } catch (error) {
    safeError(response, error, "Çıkış yapılamadı.");
  }
});

app.get("/api/users/search", authRequired, async (request, response) => {
  const query = normalizeName(String(request.query.q || "").slice(0, 100)).replace(/[%_]/g, "");
  if (query.length < 2) return response.json({ users: [] });
  try {
    const result = await pool.query(
      `SELECT id, full_name AS "fullName", email
       FROM users
       WHERE normalized_name LIKE $1 AND id <> $2
       ORDER BY normalized_name
       LIMIT 10`,
      [`%${query}%`, request.user.id],
    );
    response.json({ users: result.rows.map((user) => ({ id: user.id, fullName: user.fullName, emailHint: maskEmail(user.email) })) });
  } catch (error) {
    safeError(response, error, "Kullanıcı araması yapılamadı.");
  }
});

app.post("/api/bills", authRequired, async (request, response) => {
  const title = String(request.body?.title || "Arkadaşlarla yemek").trim().slice(0, 80) || "Arkadaşlarla yemek";
  const selectedIds = (Array.isArray(request.body?.participantUserIds) ? request.body.participantUserIds : [])
    .map(String)
    .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
  const participantUserIds = [...new Set([request.user.id, ...selectedIds])].slice(0, 50);
  const cleanItems = (Array.isArray(request.body?.items) ? request.body.items : []).map((item) => ({
    id: crypto.randomUUID(),
    name: String(item.name || "Ürün").trim().slice(0, 120) || "Ürün",
    quantity: Math.max(1, Math.min(99, Math.round(Number(item.quantity) || 1))),
    totalCents: Math.round(Number(item.totalCents) || 0),
  })).filter((item) => item.totalCents > 0).slice(0, 100);
  if (!cleanItems.length) return response.status(400).json({ error: "En az bir geçerli kalem gerekli." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const users = await client.query(
      'SELECT id, full_name AS "fullName", normalized_name AS "normalizedName" FROM users WHERE id = ANY($1::uuid[])',
      [participantUserIds],
    );
    if (!users.rows.some((user) => user.id === request.user.id)) throw new Error("Hesap sahibi bulunamadı.");
    const id = makeCode();
    await client.query("INSERT INTO bills (id, title, created_by_user_id) VALUES ($1, $2, $3)", [id, title, request.user.id]);
    for (let index = 0; index < cleanItems.length; index += 1) {
      const item = cleanItems[index];
      await client.query(
        "INSERT INTO items (id, bill_id, name, quantity, total_cents, sort_order) VALUES ($1, $2, $3, $4, $5, $6)",
        [item.id, id, item.name, item.quantity, item.totalCents, index],
      );
    }
    for (const user of users.rows) {
      await client.query(
        "INSERT INTO participants (id, bill_id, user_id, name, normalized_name) VALUES ($1, $2, $3, $4, $5)",
        [crypto.randomUUID(), id, user.id, user.fullName, user.normalizedName],
      );
    }
    await client.query("COMMIT");
    response.status(201).json({ id });
  } catch (error) {
    await client.query("ROLLBACK");
    safeError(response, error, "Hesap oluşturulamadı.");
  } finally {
    client.release();
  }
});

app.get("/api/bills/:id", authRequired, async (request, response) => {
  try {
    const billId = request.params.id.toUpperCase();
    const membership = await pool.query("SELECT id FROM participants WHERE bill_id = $1 AND user_id = $2 LIMIT 1", [billId, request.user.id]);
    if (!membership.rows[0]) return response.status(403).json({ error: "Bu adisyona eklenmemişsiniz." });
    const [billResult, itemsResult, participantsResult, claimsResult] = await Promise.all([
      pool.query('SELECT id, title, created_by_user_id AS "createdByUserId", created_at AS "createdAt" FROM bills WHERE id = $1 LIMIT 1', [billId]),
      pool.query('SELECT id, bill_id AS "billId", name, quantity, total_cents AS "totalCents", sort_order AS "sortOrder" FROM items WHERE bill_id = $1 ORDER BY sort_order', [billId]),
      pool.query('SELECT id, bill_id AS "billId", user_id AS "userId", name, joined_at AS "joinedAt" FROM participants WHERE bill_id = $1 ORDER BY joined_at', [billId]),
      pool.query('SELECT id, bill_id AS "billId", item_id AS "itemId", participant_id AS "participantId", amount_cents AS "amountCents", quantity_milli AS "quantityMilli", updated_at AS "updatedAt" FROM claims WHERE bill_id = $1', [billId]),
    ]);
    if (!billResult.rows[0]) return response.status(404).json({ error: "Hesap bulunamadı." });
    response.set("Cache-Control", "no-store").json({ bill: billResult.rows[0], items: itemsResult.rows, participants: participantsResult.rows, claims: claimsResult.rows });
  } catch (error) {
    safeError(response, error, "Hesap yüklenemedi.");
  }
});

app.post("/api/bills/:id/claims", authRequired, async (request, response) => {
  const billId = request.params.id.toUpperCase();
  const itemId = String(request.body?.itemId || "");
  const amountCents = Math.max(0, Math.round(Number(request.body?.amountCents) || 0));
  const quantityMilli = Math.max(0, Math.round(Number(request.body?.quantityMilli) || 0));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [itemId]);
    const [participantResult, itemResult] = await Promise.all([
      client.query("SELECT id FROM participants WHERE user_id = $1 AND bill_id = $2 LIMIT 1", [request.user.id, billId]),
      client.query('SELECT quantity, total_cents AS "totalCents" FROM items WHERE id = $1 AND bill_id = $2 LIMIT 1', [itemId, billId]),
    ]);
    const participantId = participantResult.rows[0]?.id;
    const item = itemResult.rows[0];
    if (!participantId || !item) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "Katılımcı veya kalem bulunamadı." });
    }
    if (amountCents === 0 && quantityMilli === 0) {
      await client.query("DELETE FROM claims WHERE participant_id = $1 AND item_id = $2", [participantId, itemId]);
      await client.query("COMMIT");
      return response.json({ ok: true });
    }
    const totalsResult = await client.query(
      "SELECT COALESCE(SUM(amount_cents), 0) AS amount, COALESCE(SUM(quantity_milli), 0) AS quantity FROM claims WHERE item_id = $1 AND participant_id <> $2",
      [itemId, participantId],
    );
    const totals = totalsResult.rows[0];
    if (amountCents + Number(totals.amount) > item.totalCents || quantityMilli + Number(totals.quantity) > item.quantity * 1000) {
      await client.query("ROLLBACK");
      return response.status(409).json({ error: "Bu kalemin kalanından daha fazla seçim yapamazsınız." });
    }
    await client.query(
      `INSERT INTO claims (id, bill_id, item_id, participant_id, amount_cents, quantity_milli)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (participant_id, item_id)
       DO UPDATE SET amount_cents = EXCLUDED.amount_cents, quantity_milli = EXCLUDED.quantity_milli, updated_at = CURRENT_TIMESTAMP`,
      [crypto.randomUUID(), billId, itemId, participantId, amountCents, quantityMilli],
    );
    await client.query("COMMIT");
    response.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    safeError(response, error, "Seçiminiz kaydedilemedi.");
  } finally {
    client.release();
  }
});

app.get("*path", (_request, response) => response.sendFile(path.join(__dirname, "public", "index.html")));

async function start() {
  const schema = fs.readFileSync(path.join(__dirname, "db", "schema.sql"), "utf8");
  await pool.query(schema);
  await pool.query("DELETE FROM user_sessions WHERE expires_at <= CURRENT_TIMESTAMP");
  app.listen(port, "0.0.0.0", () => console.log(`Hesap Paylaş ${port} portunda çalışıyor.`));
}

start().catch((error) => {
  console.error("Uygulama başlatılamadı:", error);
  process.exit(1);
});
