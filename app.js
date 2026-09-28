/*
 * SISTEM PERSEDIAAN & ANALISIS HPP TOKO MERCHANDISE
 *
 * Setup:
 * 1. Buat project Supabase, lalu salin Project URL dan Publishable Key.
 * 2. Jalankan schema.sql melalui Supabase SQL Editor.
 * 3. Ganti SUPABASE_URL dan SUPABASE_KEY di bagian konfigurasi di bawah.
 * 4. Install dependency satu kali dari folder project:
 *      npm install express cors @supabase/supabase-js
 * 5. Jalankan: node app.js
 * 6. Buka: http://localhost:3000
 *
 * Kode backend, semua REST API, koneksi database, dan logika HPP berada di
 * file ini. Policy allow-all pada schema.sql hanya untuk development lokal.
 */

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// ====== KONFIGURASI SUPABASE ======
// Ganti kedua nilai ini dengan Project URL dan Publishable Key milikmu.
// Gunakan key dengan awalan sb_publishable_, bukan service_role key.
const SUPABASE_URL = 'https://povcfgzqmffzwenkcfai.supabase.co';
const SUPABASE_KEY = 'sb_publishable_1O86T77abaVY0hPdv5lZiw_Li8GclQB';
// ==================================

const PORT = 3000;
const app = express();
const supabaseConfigured =
  SUPABASE_URL !== 'https://xxxxxxxxxxxx.supabase.co' &&
  SUPABASE_KEY !== 'sb_publishable_xxxxxxxxxxxxxxxxxxxx';
const supabase = supabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

function hitungHPP(stokLama, hppLama, qtyBeli, hargaBeli) {
  const stokBaru = stokLama + qtyBeli;
  if (stokBaru <= 0) return 0;
  return Number(((stokLama * hppLama + qtyBeli * hargaBeli) / stokBaru).toFixed(2));
}

function angkaPositif(value, label, { bolehNol = false, integer = false } = {}) {
  const number = Number(value);
  const batasTidakValid = bolehNol ? number < 0 : number <= 0;
  if (!Number.isFinite(number) || batasTidakValid || (integer && !Number.isInteger(number))) {
    throw new Error(`${label} harus berupa angka ${bolehNol ? 'minimal 0' : 'lebih dari 0'}${integer ? ' bulat' : ''}.`);
  }
  return number;
}

function validasiTanggal(tanggal) {
  if (!tanggal) return new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal) || Number.isNaN(Date.parse(`${tanggal}T00:00:00Z`))) {
    throw new Error('Tanggal tidak valid. Gunakan format YYYY-MM-DD.');
  }
  return tanggal;
}

function errorDatabase(res, error, fallback = 'Terjadi kesalahan database.') {
  console.error(error);
  if (error?.code === '23505') {
    return res.status(409).json({ error: 'SKU tersebut sudah digunakan.' });
  }
  if (error?.code === '23503') {
    return res.status(409).json({ error: 'Data masih memiliki riwayat transaksi dan tidak dapat dihapus.' });
  }
  return res.status(500).json({ error: error?.message || fallback });
}

function butuhSupabase(req, res, next) {
  if (!supabase) {
    return res.status(503).json({
      error: 'Supabase belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_KEY di app.js, lalu restart server.'
    });
  }
  next();
}

function validasiProduk(body, untukUpdate = false) {
  const payload = {};
  if (!untukUpdate || body.sku !== undefined) {
    payload.sku = String(body.sku || '').trim();
    if (!payload.sku) throw new Error('SKU wajib diisi.');
  }
  if (!untukUpdate || body.nama !== undefined) {
    payload.nama = String(body.nama || '').trim();
    if (!payload.nama) throw new Error('Nama produk wajib diisi.');
  }
  if (!untukUpdate || body.kategori !== undefined) {
    payload.kategori = String(body.kategori || 'Lainnya').trim() || 'Lainnya';
  }
  if (!untukUpdate || body.harga_jual !== undefined) {
    payload.harga_jual = angkaPositif(body.harga_jual, 'Harga jual', { bolehNol: true });
  }
  return payload;
}

function tanganiValidasi(res, error) {
  return res.status(400).json({ error: error.message });
}

app.use('/api', butuhSupabase);

// Produk: stok dan HPP hanya berubah melalui transaksi pembelian/penjualan.
app.get('/api/produk', async (req, res) => {
  const { data, error } = await supabase.from('produk').select('*').order('nama');
  if (error) return errorDatabase(res, error);
  res.json(data);
});

app.get('/api/produk/:id', async (req, res) => {
  const { data, error } = await supabase.from('produk').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return errorDatabase(res, error);
  if (!data) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
  res.json(data);
});

app.post('/api/produk', async (req, res) => {
  let payload;
  try {
    payload = validasiProduk(req.body);
  } catch (error) {
    return tanganiValidasi(res, error);
  }
  const { data, error } = await supabase
    .from('produk')
    .insert({ ...payload, stok: 0, hpp: 0 })
    .select()
    .single();
  if (error) return errorDatabase(res, error);
  res.status(201).json(data);
});

app.put('/api/produk/:id', async (req, res) => {
  let payload;
  try {
    payload = validasiProduk(req.body, true);
    if (!Object.keys(payload).length) throw new Error('Tidak ada data produk yang diperbarui.');
  } catch (error) {
    return tanganiValidasi(res, error);
  }
  const { data, error } = await supabase
    .from('produk')
    .update(payload)
    .eq('id', req.params.id)
    .select()
    .maybeSingle();
  if (error) return errorDatabase(res, error);
  if (!data) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
  res.json(data);
});

app.delete('/api/produk/:id', async (req, res) => {
  const { data: riwayat, error: errorRiwayat } = await supabase
    .from('pembelian')
    .select('id')
    .eq('produk_id', req.params.id)
    .limit(1);
  if (errorRiwayat) return errorDatabase(res, errorRiwayat);
  const { data: riwayatJual, error: errorJual } = await supabase
    .from('penjualan')
    .select('id')
    .eq('produk_id', req.params.id)
    .limit(1);
  if (errorJual) return errorDatabase(res, errorJual);
  if (riwayat.length || riwayatJual.length) {
    return res.status(409).json({ error: 'Produk memiliki riwayat transaksi. Hapus transaksi terkait sebelum menghapus produk.' });
  }
  const { data, error } = await supabase.from('produk').delete().eq('id', req.params.id).select('id').maybeSingle();
  if (error) return errorDatabase(res, error);
  if (!data) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
  res.json({ message: 'Produk berhasil dihapus.' });
});

// Pembelian menambah stok dan menghitung ulang HPP average.
app.get('/api/pembelian', async (req, res) => {
  const { data, error } = await supabase.from('pembelian').select('*').order('tanggal', { ascending: false });
  if (error) return errorDatabase(res, error);
  const { data: produk, error: errorProduk } = await supabase.from('produk').select('id, sku, nama');
  if (errorProduk) return errorDatabase(res, errorProduk);
  const namaProduk = new Map(produk.map((item) => [String(item.id), item]));
  res.json(data.map((item) => ({ ...item, produk: namaProduk.get(String(item.produk_id)) || null })));
});

app.post('/api/pembelian', async (req, res) => {
  let qty;
  let hargaSatuan;
  let tanggal;
  try {
    qty = angkaPositif(req.body.qty, 'Jumlah pembelian', { integer: true });
    hargaSatuan = angkaPositif(req.body.harga_satuan, 'Harga satuan', { bolehNol: true });
    tanggal = validasiTanggal(req.body.tanggal);
  } catch (error) {
    return tanganiValidasi(res, error);
  }
  const { data: produk, error: errorProduk } = await supabase
    .from('produk')
    .select('*')
    .eq('id', req.body.produk_id)
    .maybeSingle();
  if (errorProduk) return errorDatabase(res, errorProduk);
  if (!produk) return res.status(404).json({ error: 'Produk tidak ditemukan.' });

  const stokBaru = produk.stok + qty;
  const hppBaru = hitungHPP(produk.stok, Number(produk.hpp), qty, hargaSatuan);
  const { data: diperbarui, error: errorUpdate } = await supabase
    .from('produk')
    .update({ stok: stokBaru, hpp: hppBaru })
    .eq('id', produk.id)
    .select()
    .single();
  if (errorUpdate) return errorDatabase(res, errorUpdate);

  const { data: pembelian, error } = await supabase
    .from('pembelian')
    .insert({
      produk_id: produk.id,
      qty,
      harga_satuan: hargaSatuan,
      total: Number((qty * hargaSatuan).toFixed(2)),
      supplier: String(req.body.supplier || '').trim(),
      tanggal
    })
    .select()
    .single();
  if (error) {
    await supabase.from('produk').update({ stok: produk.stok, hpp: produk.hpp }).eq('id', produk.id);
    return errorDatabase(res, error);
  }
  res.status(201).json({ ...pembelian, produk: diperbarui, hpp_baru: hppBaru });
});

// Penjualan menolak stok minus dan menyimpan HPP saat transaksi untuk laba historis.
app.get('/api/penjualan', async (req, res) => {
  const { data, error } = await supabase.from('penjualan').select('*').order('tanggal', { ascending: false });
  if (error) return errorDatabase(res, error);
  const { data: produk, error: errorProduk } = await supabase.from('produk').select('id, sku, nama');
  if (errorProduk) return errorDatabase(res, errorProduk);
  const namaProduk = new Map(produk.map((item) => [String(item.id), item]));
  res.json(data.map((item) => ({ ...item, produk: namaProduk.get(String(item.produk_id)) || null })));
});

app.post('/api/penjualan', async (req, res) => {
  let qty;
  let hargaJual;
  let tanggal;
  try {
    qty = angkaPositif(req.body.qty, 'Jumlah penjualan', { integer: true });
    hargaJual = angkaPositif(req.body.harga_jual, 'Harga jual', { bolehNol: true });
    tanggal = validasiTanggal(req.body.tanggal);
  } catch (error) {
    return tanganiValidasi(res, error);
  }
  const { data: produk, error: errorProduk } = await supabase
    .from('produk')
    .select('*')
    .eq('id', req.body.produk_id)
    .maybeSingle();
  if (errorProduk) return errorDatabase(res, errorProduk);
  if (!produk) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
  if (produk.stok < qty) {
    return res.status(400).json({ error: `Stok tidak cukup. Stok tersedia ${produk.stok}.` });
  }

  const stokLama = produk.stok;
  const stokBaru = stokLama - qty;
  const hppTransaksi = Number(produk.hpp);
  const { error: errorUpdate } = await supabase
    .from('produk')
    .update({ stok: stokBaru })
    .eq('id', produk.id);
  if (errorUpdate) return errorDatabase(res, errorUpdate);

  const { data: penjualan, error } = await supabase
    .from('penjualan')
    .insert({
      produk_id: produk.id,
      qty,
      harga_jual: hargaJual,
      hpp_saat_transaksi: hppTransaksi,
      total: Number((qty * hargaJual).toFixed(2)),
      tanggal
    })
    .select()
    .single();
  if (error) {
    await supabase.from('produk').update({ stok: stokLama }).eq('id', produk.id);
    return errorDatabase(res, error);
  }
  res.status(201).json({ ...penjualan, produk: { ...produk, stok: stokBaru } });
});

app.get('/api/dashboard', async (req, res) => {
  const [hasilProduk, hasilPenjualan] = await Promise.all([
    supabase.from('produk').select('id, stok'),
    supabase.from('penjualan').select('qty, harga_jual, hpp_saat_transaksi')
  ]);
  if (hasilProduk.error) return errorDatabase(res, hasilProduk.error);
  if (hasilPenjualan.error) return errorDatabase(res, hasilPenjualan.error);
  const totalLaba = hasilPenjualan.data.reduce(
    (sum, item) => sum + item.qty * (Number(item.harga_jual) - Number(item.hpp_saat_transaksi)),
    0
  );
  res.json({
    total_produk: hasilProduk.data.length,
    total_stok: hasilProduk.data.reduce((sum, item) => sum + item.stok, 0),
    total_laba: Number(totalLaba.toFixed(2)),
    stok_minimum: hasilProduk.data.filter((item) => item.stok <= 5).length
  });
});

app.get('/api/analisis-hpp', async (req, res) => {
  const [hasilProduk, hasilPenjualan] = await Promise.all([
    supabase.from('produk').select('*').order('nama'),
    supabase.from('penjualan').select('produk_id, qty, harga_jual, hpp_saat_transaksi')
  ]);
  if (hasilProduk.error) return errorDatabase(res, hasilProduk.error);
  if (hasilPenjualan.error) return errorDatabase(res, hasilPenjualan.error);

  const labaPerProduk = new Map();
  for (const item of hasilPenjualan.data) {
    const key = String(item.produk_id);
    const laba = item.qty * (Number(item.harga_jual) - Number(item.hpp_saat_transaksi));
    labaPerProduk.set(key, (labaPerProduk.get(key) || 0) + laba);
  }
  res.json(hasilProduk.data.map((produk) => {
    const hpp = Number(produk.hpp);
    const hargaJual = Number(produk.harga_jual);
    const margin = hargaJual - hpp;
    return {
      ...produk,
      margin: Number(margin.toFixed(2)),
      margin_persen: hargaJual > 0 ? Number(((margin / hargaJual) * 100).toFixed(2)) : 0,
      laba_kotor: Number((labaPerProduk.get(String(produk.id)) || 0).toFixed(2))
    };
  }));
});

app.get('/api/status', (req, res) => {
  res.json({ configured: Boolean(supabase), message: supabase ? 'Supabase terhubung.' : 'Supabase belum dikonfigurasi.' });
});

app.listen(PORT, () => {
  console.log(`Sistem Persediaan Merchandise berjalan di http://localhost:${PORT}`);
  if (!supabase) console.warn('Ganti SUPABASE_URL dan SUPABASE_KEY di app.js sebelum memakai API.');
});