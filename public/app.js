const state = {
  draftItems: [],
  billCode: new URLSearchParams(location.search).get("bill")?.toUpperCase() || null,
  billData: null,
  currentUser: null,
  myBills: [],
  selectedUsers: [],
  googleClientId: "",
};

const $ = (selector) => document.querySelector(selector);
const money = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" });
const amount = (cents) => money.format((Number(cents) || 0) / 100);
let toastTimer;
let searchTimer;
let refreshTimer;

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.className = error ? "show error" : "show";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = ""; }, 3000);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "İşlem tamamlanamadı.");
  return data;
}

function showAuth() {
  state.currentUser = null;
  $("#authView").classList.remove("hidden");
  $("#profileView").classList.add("hidden");
  $("#createView").classList.add("hidden");
  $("#billView").classList.add("hidden");
  $("#shareButton").classList.add("hidden");
  $("#accountArea").classList.add("hidden");
  if (refreshTimer) clearInterval(refreshTimer);
}

function showApp() {
  $("#authView").classList.add("hidden");
  $("#profileView").classList.add("hidden");
  const account = $("#accountArea");
  account.classList.remove("hidden");
  account.innerHTML = `<span class="account-name">${escapeHtml(state.currentUser.fullName)}</span><button id="logoutButton" class="button secondary" type="button">Çıkış</button>`;
  $("#logoutButton").addEventListener("click", logout);
  if (state.billCode) {
    $("#createView").classList.add("hidden");
    $("#billView").classList.remove("hidden");
    $("#shareButton").classList.remove("hidden");
    loadBill();
    refreshTimer = setInterval(() => {
      if (!["INPUT", "SELECT"].includes(document.activeElement?.tagName)) loadBill(true);
    }, 4000);
  } else {
    $("#billView").classList.add("hidden");
    $("#createView").classList.remove("hidden");
    loadMyBills();
  }
}

function showProfile() {
  $("#authView").classList.add("hidden");
  $("#createView").classList.add("hidden");
  $("#billView").classList.add("hidden");
  $("#shareButton").classList.add("hidden");
  $("#accountArea").classList.add("hidden");
  $("#profileView").classList.remove("hidden");
  $("#profileEmail").textContent = state.currentUser.email;
  $("#profileName").value = state.currentUser.fullName || "";
  $("#profileName").focus();
}

function renderGoogleButton() {
  if (!state.googleClientId || !window.google?.accounts?.id) return;
  const container = $("#googleButton");
  container.innerHTML = "";
  google.accounts.id.initialize({
    client_id: state.googleClientId,
    callback: handleGoogleCredential,
    ux_mode: "popup",
  });
  google.accounts.id.renderButton(container, {
    type: "standard",
    theme: "outline",
    size: "large",
    text: "continue_with",
    shape: "rectangular",
    logo_alignment: "left",
    width: Math.min(340, Math.max(240, window.innerWidth - 90)),
    locale: "tr",
  });
  $("#googleStatus").classList.add("hidden");
}

async function setupGoogleSignIn() {
  try {
    const data = await readJson(await fetch("/api/config", { cache: "no-store" }));
    state.googleClientId = data.googleClientId;
    if (!state.googleClientId) throw new Error("Google girişi için GOOGLE_CLIENT_ID eklenmemiş.");
    renderGoogleButton();
  } catch (error) {
    $("#googleStatus").textContent = error.message;
    $("#googleStatus").classList.add("error-text");
  }
}

async function handleGoogleCredential(googleResponse) {
  $("#googleStatus").textContent = "Google hesabı doğrulanıyor…";
  $("#googleStatus").classList.remove("hidden", "error-text");
  try {
    const data = await readJson(await fetch("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: googleResponse.credential }),
    }));
    state.currentUser = data.user;
    if (data.user.profileComplete) {
      showApp();
      toast("Google hesabıyla giriş yapıldı.");
    } else showProfile();
  } catch (error) {
    toast(error.message, true);
    $("#googleStatus").textContent = error.message;
    $("#googleStatus").classList.add("error-text");
  }
}

async function saveProfile(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    const data = await readJson(await fetch("/api/auth/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: $("#profileName").value }),
    }));
    state.currentUser = data.user;
    showApp();
    toast("Adınız ve soyadınız kaydedildi.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    window.google?.accounts?.id?.disableAutoSelect();
    showAuth();
    renderGoogleButton();
  }
}

window.onGoogleLibraryLoad = renderGoogleButton;

function renderSelectedPeople() {
  $("#selectedPeople").innerHTML = state.selectedUsers.length
    ? state.selectedUsers.map((user) => `<span class="selected-person">${escapeHtml(user.fullName)}<button type="button" data-remove-user="${user.id}" aria-label="${escapeHtml(user.fullName)} kişisini kaldır">×</button></span>`).join("")
    : '<small>Henüz başka bir kişi seçilmedi.</small>';
  document.querySelectorAll("[data-remove-user]").forEach((button) => button.addEventListener("click", () => {
    state.selectedUsers = state.selectedUsers.filter((user) => user.id !== button.dataset.removeUser);
    renderSelectedPeople();
  }));
}

async function searchUsers() {
  const query = $("#personSearch").value.trim();
  const container = $("#personSearchResults");
  if (query.length < 2) {
    container.innerHTML = "";
    return;
  }
  try {
    const data = await readJson(await fetch(`/api/users/search?q=${encodeURIComponent(query)}`, { cache: "no-store" }));
    const users = data.users.filter((user) => !state.selectedUsers.some((selected) => selected.id === user.id));
    container.innerHTML = users.length ? users.map((user) => `
      <button class="person-result" type="button" data-user-id="${user.id}">
        <span><strong>${escapeHtml(user.fullName)}</strong><small>${escapeHtml(user.emailHint)}</small></span><b>＋ Ekle</b>
      </button>`).join("") : '<p class="search-empty">Eşleşen üye bulunamadı.</p>';
    container.querySelectorAll("[data-user-id]").forEach((button) => button.addEventListener("click", () => {
      const user = users.find((entry) => entry.id === button.dataset.userId);
      if (user) state.selectedUsers.push(user);
      $("#personSearch").value = "";
      container.innerHTML = "";
      renderSelectedPeople();
    }));
  } catch (error) {
    toast(error.message, true);
  }
}

function parseMoney(raw) {
  let value = String(raw).replace(/[^\d.,]/g, "");
  const decimalIndex = Math.max(value.lastIndexOf(","), value.lastIndexOf("."));
  if (decimalIndex >= 0 && value.length - decimalIndex - 1 === 2) {
    value = `${value.slice(0, decimalIndex).replace(/[.,]/g, "")}.${value.slice(decimalIndex + 1)}`;
  } else value = value.replace(/[.,]/g, "");
  return Math.round((Number.parseFloat(value) || 0) * 100);
}

function parseReceipt(text) {
  const ignored = /^(ara\s*)?(genel\s*)?toplam|kdv|nak[iı]t|para üstü|kredi|visa|master|ödenen|tutar\s*$/i;
  const priceToken = /^\d{1,6}(?:[.,]\d{3})*[.,]\d{2}$/;
  const found = [];
  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.replace(/[|_]/g, " ").replace(/\s+/g, " ").trim();
    const tokens = line.split(" ").map((token) => token.replace(/^(?:₺|TL)+|(?:₺|TL)+$/gi, "")).filter(Boolean);
    const priceIndexes = tokens.map((token, index) => priceToken.test(token) ? index : -1).filter((index) => index >= 0);
    if (!priceIndexes.length) continue;

    const totalIndex = priceIndexes.at(-1);
    const unitIndex = priceIndexes.length >= 2 ? priceIndexes.at(-2) : -1;
    const searchBefore = unitIndex >= 0 ? unitIndex : totalIndex;
    let quantityIndex = -1;
    for (let index = searchBefore - 1; index >= 0; index -= 1) {
      if (/^\d{1,2}$/.test(tokens[index]) && Number(tokens[index]) > 0) {
        quantityIndex = index;
        break;
      }
    }

    const quantity = quantityIndex >= 0 ? Number(tokens[quantityIndex]) : 1;
    const nameEnd = quantityIndex >= 0 ? quantityIndex : searchBefore;
    let nameTokens = tokens.slice(0, nameEnd);
    while (nameTokens.length && (/^\d+$/.test(nameTokens.at(-1)) || !/[\p{L}\p{N}]/u.test(nameTokens.at(-1)))) nameTokens.pop();
    const name = nameTokens.join(" ").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").trim();
    if (!name || ignored.test(name)) continue;

    const totalCents = parseMoney(tokens[totalIndex]);
    const unitPriceCents = unitIndex >= 0 ? parseMoney(tokens[unitIndex]) : Math.round(totalCents / quantity);
    if (totalCents <= 0 || totalCents > 10_000_000) continue;
    found.push({ id: crypto.randomUUID(), name, quantity, unitPriceCents, totalCents });
  }
  return found.slice(0, 100);
}

async function preprocessImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < imageData.data.length; index += 4) {
    const gray = imageData.data[index] * .299 + imageData.data[index + 1] * .587 + imageData.data[index + 2] * .114;
    const contrast = Math.max(0, Math.min(255, (gray - 128) * 1.45 + 150));
    imageData.data[index] = contrast;
    imageData.data[index + 1] = contrast;
    imageData.data[index + 2] = contrast;
  }
  context.putImageData(imageData, 0, 0);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob || file), "image/jpeg", .92));
}

async function scanReceipt(file) {
  if (!file?.type.startsWith("image/")) return toast("Lütfen bir fotoğraf seçin.", true);
  $("#receiptPreview").src = URL.createObjectURL(file);
  $("#receiptPreview").classList.remove("hidden");
  $("#previewPlaceholder").classList.add("hidden");
  $("#ocrBox").classList.remove("hidden");
  $("#ocrProgress").value = 3;
  $("#ocrPercent").textContent = "%3";
  $("#ocrStatus").textContent = "Görüntü hazırlanıyor";
  try {
    const processed = await preprocessImage(file);
    const worker = await Tesseract.createWorker(["tur", "eng"], 1, {
      workerPath: "/vendor/tesseract/worker.min.js",
      logger(event) {
        if (event.status === "recognizing text") {
          const progress = Math.max(8, Math.round(event.progress * 100));
          $("#ocrProgress").value = progress;
          $("#ocrPercent").textContent = `%${progress}`;
          $("#ocrStatus").textContent = "Fişteki yazılar okunuyor";
        }
      },
    });
    await worker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
    const result = await worker.recognize(processed);
    await worker.terminate();
    state.draftItems = parseReceipt(result.data.text);
    renderDraftItems();
    toast(state.draftItems.length ? `${state.draftItems.length} kalem bulundu. Fiyatları kontrol edin.` : "Kalem bulunamadı; elle ekleyebilirsiniz.");
  } catch (error) {
    console.error(error);
    toast("Fiş okunamadı. Kalemleri elle ekleyebilirsiniz.", true);
  } finally {
    $("#ocrBox").classList.add("hidden");
  }
}

function renderDraftItems() {
  const container = $("#itemsEditor");
  if (!state.draftItems.length) {
    container.innerHTML = '<div class="empty"><span>⌗</span><strong>Okunan kalemler burada görünecek</strong><p>OCR sonucunu paylaşmadan önce düzenleyebilirsiniz.</p></div>';
  } else {
    container.innerHTML = `<div class="items-head"><span>#</span><span>Ürün</span><span>Adet</span><span>Birim fiyat</span><span>Toplam</span><span></span></div>` + state.draftItems.map((item, index) => `
      <div class="edit-row" data-id="${item.id}">
        <span class="index">${index + 1}</span>
        <label class="field name-field"><span>Ürün</span><input class="item-name" aria-label="${index + 1}. ürün adı" value="${escapeHtml(item.name)}" /></label>
        <label class="field qty-field"><span>Adet</span><input class="qty" aria-label="Ürün adedi" type="number" min="1" max="99" value="${item.quantity}" /></label>
        <label class="field unit-field"><span>Birim fiyat</span><input class="unit-price" aria-label="Ürün birim fiyatı" inputmode="decimal" value="${((item.unitPriceCents ?? Math.round(item.totalCents / item.quantity)) / 100).toFixed(2).replace(".", ",")}" /></label>
        <label class="field total-field"><span>Toplam</span><input class="price" aria-label="Ürün toplam fiyatı" inputmode="decimal" value="${(item.totalCents / 100).toFixed(2).replace(".", ",")}" /></label>
        <button class="delete" type="button" aria-label="Kalemi sil">✕</button>
      </div>`).join("");
    container.querySelectorAll(".edit-row").forEach((row) => {
      const item = state.draftItems.find((entry) => entry.id === row.dataset.id);
      row.querySelector(".item-name").addEventListener("input", (event) => { item.name = event.target.value; });
      row.querySelector(".qty").addEventListener("input", (event) => {
        item.quantity = Math.max(1, Number(event.target.value) || 1);
        item.totalCents = item.quantity * item.unitPriceCents;
        row.querySelector(".price").value = (item.totalCents / 100).toFixed(2).replace(".", ",");
        updateDraftTotal();
      });
      row.querySelector(".unit-price").addEventListener("input", (event) => {
        item.unitPriceCents = parseMoney(event.target.value);
        item.totalCents = item.quantity * item.unitPriceCents;
        row.querySelector(".price").value = (item.totalCents / 100).toFixed(2).replace(".", ",");
        updateDraftTotal();
      });
      row.querySelector(".price").addEventListener("input", (event) => {
        item.totalCents = parseMoney(event.target.value);
        item.unitPriceCents = Math.round(item.totalCents / item.quantity);
        row.querySelector(".unit-price").value = (item.unitPriceCents / 100).toFixed(2).replace(".", ",");
        updateDraftTotal();
      });
      row.querySelector(".delete").addEventListener("click", () => { state.draftItems = state.draftItems.filter((entry) => entry.id !== item.id); renderDraftItems(); });
    });
  }
  updateDraftTotal();
  $("#createBillButton").disabled = !state.draftItems.length;
}

function updateDraftTotal() {
  $("#draftTotal").textContent = amount(state.draftItems.reduce((sum, item) => sum + item.totalCents, 0));
}

async function createBill() {
  const validItems = state.draftItems.filter((item) => item.name.trim() && item.totalCents > 0);
  if (!validItems.length) return toast("En az bir ürün ve fiyat ekleyin.", true);
  const button = $("#createBillButton");
  button.disabled = true;
  button.textContent = "Oluşturuluyor…";
  try {
    const response = await fetch("/api/bills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: $("#billTitle").value,
        items: validItems,
        participantUserIds: state.selectedUsers.map((user) => user.id),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    location.href = `/?bill=${data.id}`;
  } catch (error) {
    toast(error.message || "Hesap oluşturulamadı.", true);
    button.disabled = false;
    button.textContent = "Hesabı oluştur";
  }
}

function formatBillDate(value) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(value));
}

function renderMyBills() {
  const container = $("#myBills");
  if (!state.myBills.length) {
    container.innerHTML = `<div class="my-bills-heading"><div><h2>Adisyonlarım</h2><p>Henüz eklendiğiniz bir adisyon yok.</p></div></div>`;
    return;
  }

  container.innerHTML = `
    <div class="my-bills-heading"><div><h2>Adisyonlarım</h2><p>Dahil olduğunuz adisyonlardan birini açarak paylaşımı güncelleyebilirsiniz.</p></div></div>
    <div class="my-bills-list">${state.myBills.map((bill) => `
      <a class="my-bill-card ${bill.hasPayment ? "" : "needs-payment"}" href="/?bill=${encodeURIComponent(bill.id)}">
        <div><span class="code light">KOD · ${escapeHtml(bill.id)}</span><h3>${escapeHtml(bill.title)}</h3><p>${escapeHtml(formatBillDate(bill.createdAt))} · Toplam ${amount(bill.totalCents)}</p></div>
        ${bill.hasPayment ? `<span class="payment-alert" role="status">ÖDEME PAYIN KAYITLI<br /><strong>${amount(bill.myPaidCents)}</strong></span>` : '<span class="payment-reminder" role="status">ÖDEME PAYINI<br />GİR</span>'}
      </a>`).join("")}</div>`;
}

async function loadMyBills() {
  const container = $("#myBills");
  container.innerHTML = `<div class="my-bills-heading"><div><h2>Adisyonlarım</h2><p>Adisyonlarınız yükleniyor…</p></div></div>`;
  try {
    const data = await readJson(await fetch("/api/bills/mine", { cache: "no-store" }));
    state.myBills = data.bills;
    renderMyBills();
  } catch (error) {
    container.innerHTML = `<div class="my-bills-heading"><div><h2>Adisyonlarım</h2><p>Adisyonlarınız şu an yüklenemedi.</p></div></div>`;
    toast(error.message || "Adisyonlarınız yüklenemedi.", true);
  }
}

async function loadBill(silent = false) {
  try {
    const response = await fetch(`/api/bills/${state.billCode}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    state.billData = data;
    renderSharedBill();
  } catch (error) {
    if (!silent) toast(error.message || "Hesap yüklenemedi.", true);
  }
}

function renderSharedBill() {
  const data = state.billData;
  const total = data.items.reduce((sum, item) => sum + Number(item.totalCents), 0);
  const selected = data.claims.reduce((sum, claim) => sum + Number(claim.amountCents), 0);
  const remaining = Math.max(0, total - selected);
  $("#billSummary").innerHTML = `
    <div class="summary-main"><div><span class="code">KOD · ${escapeHtml(state.billCode)}</span><h1>${escapeHtml(data.bill.title)}</h1><p>${data.participants.length} kişi katıldı · otomatik yenilenir</p></div>
    <div class="summary-values"><div class="metric"><small>TOPLAM</small><strong>${amount(total)}</strong></div><div class="metric"><small>SEÇİLDİ</small><strong>${amount(selected)}</strong></div><div class="metric remaining"><small>KALDI</small><strong>${amount(remaining)}</strong></div></div></div>
    <div class="bar"><span style="width:${total ? Math.min(100, selected / total * 100) : 0}%"></span></div>`;

  const currentPerson = data.participants.find((person) => person.userId === state.currentUser.id);
  $("#joinArea").innerHTML = `<div class="person-box"><span class="avatar">${escapeHtml(currentPerson.name.charAt(0).toLocaleUpperCase("tr-TR"))}</span><span><strong>${escapeHtml(currentPerson.name)}</strong> olarak seçim yapıyorsun.</span></div>`;

  $("#sharedItems").innerHTML = data.items.map((item) => {
    const claims = data.claims.filter((claim) => claim.itemId === item.id);
    const used = claims.reduce((sum, claim) => sum + Number(claim.amountCents), 0);
    const remainingAmount = Math.max(0, Number(item.totalCents) - used);
    const mine = claims.find((claim) => claim.participantId === currentPerson.id);
    const tags = claims.map((claim) => {
      const person = data.participants.find((entry) => entry.id === claim.participantId);
      return `<span class="claim-tag ${claim.participantId === currentPerson.id ? "mine" : ""}">${escapeHtml(person?.name || "Biri")} · ${amount(claim.amountCents)}</span>`;
    }).join("");
    const savedQuantity = Number(mine?.quantityMilli || 0) / 1000;
    const mode = !mine || savedQuantity > 0 ? "quantity" : "amount";
    const claimForm = currentPerson && (remainingAmount > 0 || mine) ? `
      <div class="claim-form" data-item-id="${item.id}" data-price="${item.totalCents}" data-quantity="${item.quantity}">
        <select class="claim-mode" aria-label="Paylaşım şekli"><option value="quantity" ${mode === "quantity" ? "selected" : ""}>Adet</option><option value="amount" ${mode === "amount" ? "selected" : ""}>Tutar</option></select>
        <span class="claim-value-container">${claimValueField(item, mode, mode === "quantity" ? savedQuantity : Number(mine?.amountCents || 0) / 100)}</span>
      </div>` : "";
    return `<article class="item-card"><div class="item-top"><div><h2>${escapeHtml(item.name)}</h2>${remainingAmount === 0 ? '<span class="done">✓ TAMAMLANDI</span>' : ""}<p>${item.quantity} adet · ${amount(item.totalCents)}</p></div><div class="remaining-price"><small>Kalan</small><strong>${amount(remainingAmount)}</strong></div></div>${tags ? `<div class="claim-tags">${tags}</div>` : ""}${claimForm}</article>`;
  }).join("");
  document.querySelectorAll(".claim-form").forEach((form) => {
    form.querySelector(".claim-mode").addEventListener("change", () => {
      const mode = form.querySelector(".claim-mode").value;
      form.querySelector(".claim-value-container").innerHTML = claimValueField({ quantity: form.dataset.quantity }, mode, 0);
      watchClaimValue(form);
      updatePaymentSummary();
    });
    watchClaimValue(form);
  });
  renderPaymentSummary();
}

function claimValueField(item, mode, value) {
  if (mode === "quantity") {
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const selected = Number(value) || 0;
    const values = Array.from({ length: quantity + 1 }, (_unused, index) => index);
    if (!values.includes(selected)) values.push(selected);
    values.sort((first, second) => first - second);
    return `<select class="claim-value" aria-label="Yediğim adet">${values.map((entry) => `<option value="${entry}" ${entry === selected ? "selected" : ""}>${entry === 0 ? "Adet seç" : `${entry} adet`}</option>`).join("")}</select>`;
  }
  return `<input class="claim-value" type="number" min="0" step="0.01" inputmode="decimal" value="${Number(value) || ""}" placeholder="Tutar" aria-label="Ödediğim pay" />`;
}

function watchClaimValue(form) {
  const field = form.querySelector(".claim-value");
  field.addEventListener("input", updatePaymentSummary);
  field.addEventListener("change", updatePaymentSummary);
}

function claimPayload(form) {
  const mode = form.querySelector(".claim-mode").value;
  const value = Math.max(0, Number(form.querySelector(".claim-value").value) || 0);
  let amountCents = Math.round(value * 100);
  let quantityMilli = 0;
  if (mode === "quantity") {
    quantityMilli = Math.round(value * 1000);
    amountCents = Math.round(Number(form.dataset.price) * quantityMilli / (Number(form.dataset.quantity) * 1000));
  }
  return { itemId: form.dataset.itemId, amountCents, quantityMilli };
}

function renderPaymentSummary() {
  $("#paymentSummary").innerHTML = `<section class="payment-summary"><div><small>ÖDEMEN GEREKEN TOPLAM</small><strong id="myPaymentTotal">${amount(0)}</strong><p id="paymentSummaryNote">Yediğin kalemleri seç; ardından hepsini tek seferde kaydet.</p></div><button id="saveAllClaimsButton" class="button primary" type="button">Seçimlerimi kaydet</button></section>`;
  $("#saveAllClaimsButton").addEventListener("click", saveAllClaims);
  updatePaymentSummary();
}

function updatePaymentSummary() {
  const total = [...document.querySelectorAll(".claim-form")]
    .map(claimPayload)
    .reduce((sum, claim) => sum + claim.amountCents, 0);
  const totalElement = $("#myPaymentTotal");
  const note = $("#paymentSummaryNote");
  if (!totalElement || !note) return;
  totalElement.textContent = amount(total);
  note.textContent = total ? "Bu tutar, mevcut seçimlerine göre hesaplanır." : "Henüz bir kalem seçmedin.";
}

async function saveAllClaims() {
  const button = $("#saveAllClaimsButton");
  const claims = [...document.querySelectorAll(".claim-form")].map(claimPayload);
  button.disabled = true;
  button.textContent = "Kaydediliyor…";
  try {
    for (const claim of claims) {
      await readJson(await fetch(`/api/bills/${state.billCode}/claims`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(claim) }));
    }
    await loadBill(true);
    toast("Seçimlerin kaydedildi.");
  } catch (error) {
    await loadBill(true);
    toast(error.message || "Seçimlerin kaydedilemedi.", true);
  }
}

async function initialize() {
  $("#profileForm").addEventListener("submit", saveProfile);
  $("#profileLogoutButton").addEventListener("click", logout);
  $("#cameraButton").addEventListener("click", () => $("#cameraInput").click());
  $("#galleryButton").addEventListener("click", () => $("#galleryInput").click());
  $("#cameraInput").addEventListener("change", (event) => scanReceipt(event.target.files[0]));
  $("#galleryInput").addEventListener("change", (event) => scanReceipt(event.target.files[0]));
  $("#addItemButton").addEventListener("click", () => { state.draftItems.push({ id: crypto.randomUUID(), name: "", quantity: 1, unitPriceCents: 0, totalCents: 0 }); renderDraftItems(); });
  $("#createBillButton").addEventListener("click", createBill);
  $("#personSearch").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchUsers, 300);
  });
  renderSelectedPeople();
  $("#shareButton").addEventListener("click", async () => {
    await navigator.clipboard.writeText(location.href);
    toast("Bağlantı kopyalandı.");
  });
  try {
    const data = await readJson(await fetch("/api/auth/me", { cache: "no-store" }));
    state.currentUser = data.user;
    if (data.user.profileComplete) showApp();
    else showProfile();
  } catch {
    showAuth();
  }
  await setupGoogleSignIn();
}

initialize();
