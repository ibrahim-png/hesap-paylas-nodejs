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
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor/tesseract", express.static(path.join(__dirname, "node_modules", "tesseract.js", "dist")));

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.randomBytes(7), (byte) => alphabet[byte % alphabet.length]).join("");
}

function normalizeName(name) {
  return name.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
}

function safeError(response, error, message) {
  console.error(message, error);
  response.status(500).json({ error: message });
}

app.get("/api/health", async (_request, response) => {
  try {
    await pool.query("SELECT 1");
    response.json({ ok: true });
  } catch (error) {
    response.status(503).json({ ok: false });
  }
});

app.post("/api/bills", async (request, response) => {
  const title = String(request.body?.title || "Arkadaşlarla yemek").trim().slice(0, 80) || "Arkadaşlarla yemek";
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
    const id = makeCode();
    await client.query("INSERT INTO bills (id, title) VALUES ($1, $2)", [id, title]);
    for (let index = 0; index < cleanItems.length; index += 1) {
      const item = cleanItems[index];
      await client.query(
        "INSERT INTO items (id, bill_id, name, quantity, total_cents, sort_order) VALUES ($1, $2, $3, $4, $5, $6)",
        [item.id, id, item.name, item.quantity, item.totalCents, index],
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

app.get("/api/bills/:id", async (request, response) => {
  try {
    const billId = request.params.id.toUpperCase();
    const [billResult, itemsResult, participantsResult, claimsResult] = await Promise.all([
      pool.query('SELECT id, title, created_at AS "createdAt" FROM bills WHERE id = $1 LIMIT 1', [billId]),
      pool.query('SELECT id, bill_id AS "billId", name, quantity, total_cents AS "totalCents", sort_order AS "sortOrder" FROM items WHERE bill_id = $1 ORDER BY sort_order', [billId]),
      pool.query('SELECT id, bill_id AS "billId", name, joined_at AS "joinedAt" FROM participants WHERE bill_id = $1', [billId]),
      pool.query('SELECT id, bill_id AS "billId", item_id AS "itemId", participant_id AS "participantId", amount_cents AS "amountCents", quantity_milli AS "quantityMilli", updated_at AS "updatedAt" FROM claims WHERE bill_id = $1', [billId]),
    ]);
    if (!billResult.rows[0]) return response.status(404).json({ error: "Hesap bulunamadı." });
    response.set("Cache-Control", "no-store").json({ bill: billResult.rows[0], items: itemsResult.rows, participants: participantsResult.rows, claims: claimsResult.rows });
  } catch (error) {
    safeError(response, error, "Hesap yüklenemedi.");
  }
});

app.post("/api/bills/:id/join", async (request, response) => {
  try {
    const billId = request.params.id.toUpperCase();
    const name = String(request.body?.name || "").trim().replace(/\s+/g, " ").slice(0, 50);
    if (name.length < 2) return response.status(400).json({ error: "Lütfen adınızı yazın." });
    const bill = await pool.query("SELECT id FROM bills WHERE id = $1 LIMIT 1", [billId]);
    if (!bill.rows.length) return response.status(404).json({ error: "Hesap bulunamadı." });
    const result = await pool.query(
      `INSERT INTO participants (id, bill_id, name, normalized_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (bill_id, normalized_name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, bill_id AS "billId", name, joined_at AS "joinedAt"`,
      [crypto.randomUUID(), billId, name, normalizeName(name)],
    );
    response.status(201).json({ participant: result.rows[0] });
  } catch (error) {
    safeError(response, error, "Katılım tamamlanamadı.");
  }
});

app.post("/api/bills/:id/claims", async (request, response) => {
  const billId = request.params.id.toUpperCase();
  const participantId = String(request.body?.participantId || "");
  const itemId = String(request.body?.itemId || "");
  const amountCents = Math.max(0, Math.round(Number(request.body?.amountCents) || 0));
  const quantityMilli = Math.max(0, Math.round(Number(request.body?.quantityMilli) || 0));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [itemId]);
    const [participant, itemResult] = await Promise.all([
      client.query("SELECT id FROM participants WHERE id = $1 AND bill_id = $2 LIMIT 1", [participantId, billId]),
      client.query('SELECT quantity, total_cents AS "totalCents" FROM items WHERE id = $1 AND bill_id = $2 LIMIT 1', [itemId, billId]),
    ]);
    const item = itemResult.rows[0];
    if (!participant.rows.length || !item) {
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
  app.listen(port, "0.0.0.0", () => console.log(`Hesap Paylaş ${port} portunda çalışıyor.`));
}

start().catch((error) => {
  console.error("Uygulama başlatılamadı:", error);
  process.exit(1);
});
