# Hesap Paylaş — Node.js + Neon

Restoran fişini Tesseract.js ile okuyup ürünleri arkadaşlar arasında adet veya tutar bazında paylaştıran mobil uyumlu web uygulaması.

## Özellikler

- Telefondan yeni fotoğraf çekme veya galeriden mevcut fiş fotoğrafı yükleme
- Ücretsiz Tesseract.js OCR (`tur` + `eng`)
- OCR öncesi kontrast ve gri tonlama iyileştirmesi
- Bulunan ürünleri, adetleri ve fiyatları düzeltme
- Paylaşılabilir bağlantı ve 7 karakterli hesap kodu
- Ad-soyad, Gmail ve şifreyle üyelik/giriş
- Ad-soyad aramasıyla adisyona kişi ekleme
- Güvenli, 30 günlük oturum; şifreleri `scrypt` ile tuzlanmış hash olarak saklama
- Ürünü adet veya TL tutarı üzerinden bölüştürme
- Kimin hangi kalemi üstlendiğini ve kalan toplamı gösterme
- Neon PostgreSQL üzerinde kalıcı veri
- Aynı kalemin eşzamanlı olarak fazla seçilmesini engelleyen veritabanı kilidi

Fiş fotoğrafı sunucuya gönderilmez. OCR kullanıcının tarayıcısında çalışır; Neon'a yalnızca kullanıcının kontrol ettiği ürün, fiyat ve paylaşım bilgileri kaydedilir.

## Teknolojiler

- Node.js ve Express
- PostgreSQL / Neon
- Tesseract.js
- Vanilla HTML, CSS ve JavaScript

## Yerel çalıştırma

```bash
npm install
```

`.env.example` dosyasını `.env` adıyla kopyalayın ve Neon bağlantı adresini girin:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
PORT=3000
```

Ardından:

```bash
npm start
```

Uygulama açılırken `db/schema.sql` dosyasını otomatik çalıştırır ve eksik tabloları oluşturur.

## Render'a deploy

1. Render'da **New → Web Service** seçin.
2. Bu GitHub reposunu bağlayın.
3. `render.yaml` algılanırsa Blueprint olarak devam edebilirsiniz.
4. `DATABASE_URL` ortam değişkenine Neon bağlantı adresinizi ekleyin.
5. Build komutu: `npm ci`
6. Start komutu: `npm start`

Deploy sonrasında `/api/health` adresinin `{ "ok": true }` döndürmesi gerekir.

## Veritabanı tabloları

- `users`: Üyeler ve güvenli şifre hash'leri
- `user_sessions`: Oturumlar
- `bills`: Paylaşılan hesaplar ve oluşturan üye
- `items`: Fişteki ürünler
- `participants`: Adisyona seçilen üyeler
- `claims`: Kişilerin üstlendiği adet ve tutarlar

Para değerleri küsurat hatalarını önlemek için kuruş cinsinden tam sayı olarak saklanır.
