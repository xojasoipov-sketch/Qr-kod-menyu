'use client';

import { useState, useEffect, useRef } from 'react';
import { db } from '@/lib/db/store';
import { Table, Restaurant } from '@/types/database';
import QRCode from 'qrcode';
import { 
  QrCode, 
  Plus, 
  RefreshCw, 
  Printer, 
  Copy, 
  Check, 
  ShieldCheck, 
  X,
  Layers,
  Door,
  Users,
  LayoutGrid,
  Filter
} from 'lucide-react';

const ZONES = [
  'Barchasi',
  'Asosiy Zal',
  'Yozgi Terrasa',
  'Bar Zonasi',
  'Deraza yonida',
  'VIP Sekciya',
  'Alohida Xonalar',
];

export default function AdminTablesPage() {
  const [branchId] = useState('branch-001');
  const [allTables, setAllTables] = useState<Table[]>(() => db.getTablesByBranch(branchId));
  const [selectedZone, setSelectedZone] = useState('Barchasi');
  const [restaurant] = useState<Restaurant | undefined>(() => db.getRestaurant('rest-001'));
  const [selectedTableForQr, setSelectedTableForQr] = useState<Table | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  const [tableNumber, setTableNumber] = useState('');
  const [tableName, setTableName] = useState('');
  const [tableZone, setTableZone] = useState('Asosiy Zal');
  const [capacity, setCapacity] = useState('4');

  const printableRef = useRef<HTMLDivElement>(null);

  // Filterlangan stollar
  const tables = selectedZone === 'Barchasi' 
    ? allTables 
    : allTables.filter(t => t.zone === selectedZone);

  // Statistika
  const regularTables = allTables.filter(t => t.zone !== 'Alohida Xonalar');
  const rooms = allTables.filter(t => t.zone === 'Alohida Xonalar');
  const totalCapacity = allTables.reduce((s, t) => s + (t.capacity || 0), 0);

  const refreshTables = () => {
    const updated = db.getTablesByBranch(branchId);
    setAllTables([...updated]);
    if (selectedTableForQr) {
      const refreshedSelected = updated.find((t) => t.id === selectedTableForQr.id);
      if (refreshedSelected) setSelectedTableForQr(refreshedSelected);
    }
  };

  useEffect(() => {
    if (!selectedTableForQr) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001';
    const targetUrl = `${origin}/t/${selectedTableForQr.qr_token}`;

    QRCode.toDataURL(targetUrl, {
      width: 400,
      margin: 2,
      color: {
        dark: '#0C0A09',
        light: '#FFFFFF',
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error('QR generation error', err));
  }, [selectedTableForQr]);

  const handleRegenerateToken = async (tableId: string) => {
    if (!confirm("Ushbu QR kodni yangilasangiz, stoldagi eski qog'oz/akril QR kod o'z kuchini yo'qotadi. Davom etasizmi?")) {
      return;
    }

    setRegeneratingId(tableId);
    try {
      const res = await fetch(`/api/tables/${tableId}/regenerate-qr`, {
        method: 'POST',
      });

      if (!res.ok) {
        alert("QR kodni yangilab bo'lmadi");
      } else {
        refreshTables();
      }
    } catch {
      alert('Tarmoq xatosi');
    } finally {
      setRegeneratingId(null);
    }
  };

  const handleCreateTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tableNumber || !tableName) return;

    try {
      const payload = {
        branch_id: branchId,
        number: parseInt(tableNumber, 10),
        name: tableName,
        zone: tableZone,
        capacity: parseInt(capacity, 10),
        is_active: true,
      };

      const res = await fetch('/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        refreshTables();
        setIsCreateModalOpen(false);
        setTableNumber('');
        setTableName('');
      } else {
        const d = await res.json();
        alert(d.error || "Stol qo'shib bo'lmadi");
      }
    } catch {
      alert('Tarmoq xatosi');
    }
  };

  const handleCopyLink = (token: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    navigator.clipboard.writeText(`${origin}/t/${token}`);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const handlePrintCard = () => {
    window.print();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-surface-border">
        <div>
          <h1 className="font-serif font-bold text-2xl sm:text-3xl text-white">
            Stollar va Alohida Xonalar
          </h1>
          <p className="text-xs text-stone-400 mt-1">
            Har bir joy uchun takrorlanmas QR kodlar yaratish va chop etish
          </p>
        </div>

        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-gold-400 to-amber-500 text-stone-950 font-bold text-xs shadow-gold-glow hover:brightness-110 active:scale-95 transition-all flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>Yangi Stol/Xona Qo&apos;shish</span>
        </button>
      </div>

      {/* Statistika kartlar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-surface-100 rounded-2xl border border-surface-border p-4 text-center">
          <LayoutGrid className="w-6 h-6 text-gold-400 mx-auto mb-1" />
          <div className="font-serif font-bold text-2xl text-white">{regularTables.length}</div>
          <div className="text-[11px] text-stone-400">Umumiy Stollar</div>
        </div>
        <div className="bg-surface-100 rounded-2xl border border-surface-border p-4 text-center">
          <Door className="w-6 h-6 text-amber-400 mx-auto mb-1" />
          <div className="font-serif font-bold text-2xl text-white">{rooms.length}</div>
          <div className="text-[11px] text-stone-400">Alohida Xonalar</div>
        </div>
        <div className="bg-surface-100 rounded-2xl border border-surface-border p-4 text-center">
          <Users className="w-6 h-6 text-emerald-400 mx-auto mb-1" />
          <div className="font-serif font-bold text-2xl text-white">{totalCapacity}</div>
          <div className="text-[11px] text-stone-400">Umumiy Sig&apos;im</div>
        </div>
        <div className="bg-surface-100 rounded-2xl border border-surface-border p-4 text-center">
          <QrCode className="w-6 h-6 text-blue-400 mx-auto mb-1" />
          <div className="font-serif font-bold text-2xl text-white">{allTables.length}</div>
          <div className="text-[11px] text-stone-400">QR Kodlar</div>
        </div>
      </div>

      {/* Zona filtri */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-4 h-4 text-gold-400 shrink-0" />
        {ZONES.map(zone => (
          <button
            key={zone}
            onClick={() => setSelectedZone(zone)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
              selectedZone === zone
                ? 'bg-gold-400 text-stone-950 border-gold-400 shadow-gold-glow'
                : 'bg-surface-100 text-stone-300 border-surface-border hover:border-gold-400/50'
            }`}
          >
            {zone}
            {zone !== 'Barchasi' && (
              <span className="ml-1 opacity-60">
                ({allTables.filter(t => zone === 'Barchasi' || t.zone === zone).length})
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Stollar ro'yxati */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-surface-100 rounded-2xl border border-surface-border overflow-hidden shadow-luxury">
            <div className="p-4 bg-surface-50 border-b border-surface-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-gold-400" />
                <h2 className="font-serif font-bold text-sm text-white">
                  {selectedZone === 'Barchasi' ? 'Barcha Joylar' : selectedZone} ({tables.length} ta)
                </h2>
              </div>
              <span className="text-xs text-stone-400">Markaziy Filial</span>
            </div>

            <div className="divide-y divide-surface-border/60 max-h-[600px] overflow-y-auto">
              {tables.map((table) => {
                const isSelected = selectedTableForQr?.id === table.id;
                const isRoom = table.zone === 'Alohida Xonalar';

                return (
                  <div
                    key={table.id}
                    onClick={() => setSelectedTableForQr(table)}
                    className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-gold-500/10 border-l-4 border-l-gold-400'
                        : 'hover:bg-surface-200/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-xl border flex flex-col items-center justify-center shrink-0 ${
                        isRoom 
                          ? 'bg-amber-900/30 border-amber-500/40' 
                          : 'bg-stone-900 border-surface-border'
                      }`}>
                        <span className="text-[9px] text-stone-500 uppercase font-mono">
                          {isRoom ? 'XONA' : 'STOL'}
                        </span>
                        <span className={`font-serif font-bold text-sm ${isRoom ? 'text-amber-300' : 'text-gold-300'}`}>
                          {table.number}
                        </span>
                      </div>

                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-serif font-bold text-sm text-white">
                            {table.name}
                          </h3>
                          <span className={`px-2 py-0.5 rounded text-[10px] ${
                            isRoom 
                              ? 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
                              : 'bg-surface-50 text-stone-400'
                          }`}>
                            {table.zone || 'Asosiy Zal'}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-surface-50 text-stone-500 text-[10px]">
                            {table.capacity} kishi
                          </span>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-stone-400 mt-1">
                          <span>Token:</span>
                          <code className="px-2 py-0.5 rounded bg-stone-900 text-gold-300 font-mono text-[11px] border border-surface-border">
                            {table.qr_token}
                          </code>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyLink(table.qr_token);
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-surface-50 text-stone-300 hover:text-white border border-surface-border text-xs flex items-center gap-1"
                        title="Havolani ko'chirish"
                      >
                        {copiedToken === table.qr_token ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span className="hidden sm:inline">{copiedToken === table.qr_token ? "Ko'chirildi" : 'Havola'}</span>
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRegenerateToken(table.id);
                        }}
                        disabled={regeneratingId === table.id}
                        className="px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-300 hover:bg-red-500/20 border border-red-500/30 text-xs flex items-center gap-1"
                        title="QR kodni yangilash"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${regeneratingId === table.id ? 'animate-spin' : ''}`} />
                        <span className="hidden sm:inline">Yangilash</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: QR Chop etish paneli */}
        <div>
          {selectedTableForQr ? (
            <div className="bg-surface-100 rounded-2xl border border-surface-border p-5 shadow-luxury space-y-4 sticky top-24">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-gold-400" />
                  <h3 className="font-serif font-bold text-sm text-white">
                    QR Stend Ko&apos;rinishi
                  </h3>
                </div>
                <button
                  onClick={handlePrintCard}
                  className="px-3 py-1.5 rounded-lg bg-gold-400 text-stone-950 font-bold text-xs hover:bg-gold-300 transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Chop Etish</span>
                </button>
              </div>

              {/* Akril Stend Kartasi */}
              <div
                ref={printableRef}
                className="p-6 rounded-3xl bg-gradient-to-b from-[#1E1A16] via-[#120F0D] to-[#0A0908] border-2 border-gold-400/60 shadow-2xl text-center space-y-3 relative overflow-hidden"
              >
                <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-gold-400" />
                <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-gold-400" />
                <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-gold-400" />
                <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-gold-400" />

                <div className="font-serif font-black text-xl text-gold-300 tracking-wider uppercase">
                  {restaurant?.name || 'MUHTASHAM RESTORANI'}
                </div>
                <div className="text-[10px] text-stone-400 tracking-widest uppercase font-mono">
                  Premium Taomlar • Shohona Xizmat
                </div>

                <div className="p-3 bg-white rounded-2xl shadow-xl inline-block mx-auto border-4 border-gold-400/80">
                  {qrDataUrl && (
                    <img
                      src={qrDataUrl}
                      alt={`${selectedTableForQr.name} QR Kodi`}
                      className="w-44 h-44 mx-auto object-contain"
                    />
                  )}
                </div>

                <div className="pt-2">
                  <div className="inline-block px-4 py-1 rounded-full bg-gold-400/20 border border-gold-400/40 text-gold-300 font-serif font-bold text-sm">
                    {selectedTableForQr.name}
                  </div>
                  <div className="text-[11px] text-stone-300 font-medium mt-1">
                    {selectedTableForQr.zone === 'Alohida Xonalar' 
                      ? '🚪 Alohida Xona • Kamera orqali skanerlang'
                      : '📱 Kamera orqali skanerlang va menyudan taom tanlang'
                    }
                  </div>
                  <div className="text-[10px] text-stone-500 mt-1">
                    Sig&apos;im: {selectedTableForQr.capacity} kishi • {selectedTableForQr.zone}
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-stone-400 leading-relaxed bg-surface-50 p-3 rounded-xl border border-surface-border">
                <ShieldCheck className="w-4 h-4 text-emerald-400 inline mr-1" />
                QR kod yirtilsa yoki eskirsa, <strong>Yangilash</strong> tugmasini bosib darhol yangisini chiqaring.
              </div>
            </div>
          ) : (
            <div className="bg-surface-100 rounded-2xl border border-surface-border p-8 text-center">
              <QrCode className="w-12 h-12 text-stone-600 mx-auto mb-3" />
              <p className="text-stone-400 text-sm">
                QR kod yaratish uchun chap tarafdan stol yoki xona tanlang
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-md bg-surface-100 border border-surface-border rounded-3xl p-6 shadow-2xl animate-slide-up">
            <div className="flex items-center justify-between pb-4 border-b border-surface-border mb-4">
              <h2 className="font-serif font-bold text-lg text-white">Yangi Stol / Xona Qo&apos;shish</h2>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="w-8 h-8 rounded-full bg-surface-200 text-stone-300 hover:text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTable} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-stone-300 font-semibold mb-1">Raqami *</label>
                <input
                  type="number"
                  required
                  value={tableNumber}
                  onChange={(e) => setTableNumber(e.target.value)}
                  placeholder="Masalan: 51"
                  className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400"
                />
              </div>

              <div>
                <label className="block text-stone-300 font-semibold mb-1">Nomi *</label>
                <input
                  type="text"
                  required
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  placeholder="Masalan: 51-stol (Terrasa)"
                  className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400"
                />
              </div>

              <div>
                <label className="block text-stone-300 font-semibold mb-1">Zona / Hudud</label>
                <select
                  value={tableZone}
                  onChange={(e) => setTableZone(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400"
                >
                  <option value="Asosiy Zal">Asosiy Zal</option>
                  <option value="Yozgi Terrasa">Yozgi Terrasa</option>
                  <option value="Bar Zonasi">Bar Zonasi</option>
                  <option value="Deraza yonida">Deraza yonida</option>
                  <option value="VIP Sekciya">VIP Sekciya</option>
                  <option value="Alohida Xonalar">Alohida Xona</option>
                </select>
              </div>

              <div>
                <label className="block text-stone-300 font-semibold mb-1">Sig&apos;im (kishi)</label>
                <input
                  type="number"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder="4"
                  className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400"
                />
              </div>

              <div className="pt-4 border-t border-surface-border flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-surface-200 text-stone-300 hover:text-white"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-gold-400 text-stone-950 font-bold hover:bg-gold-300"
                >
                  Saqlash &amp; QR Yaratish
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


  const [tables, setTables] = useState<Table[]>(() => db.getTablesByBranch(branchId));
  const [restaurant] = useState<Restaurant | undefined>(() => db.getRestaurant('rest-001'));
  const [selectedTableForQr, setSelectedTableForQr] = useState<Table | null>(tables[0] || null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  const [tableNumber, setTableNumber] = useState('');
  const [tableName, setTableName] = useState('');
  const [tableZone, setTableZone] = useState('Asosiy Zal');
  const [capacity, setCapacity] = useState('4');

  const printableRef = useRef<HTMLDivElement>(null);

  const refreshTables = () => {
    const updated = db.getTablesByBranch(branchId);
    setTables([...updated]);
    if (selectedTableForQr) {
      const refreshedSelected = updated.find((t) => t.id === selectedTableForQr.id);
      if (refreshedSelected) setSelectedTableForQr(refreshedSelected);
    }
  };

  useEffect(() => {
    if (!selectedTableForQr) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://192.168.1.37:3001';
    const targetUrl = `${origin}/t/${selectedTableForQr.qr_token}`;

    QRCode.toDataURL(targetUrl, {
      width: 400,
      margin: 2,
      color: {
        dark: '#0C0A09',
        light: '#FFFFFF',
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error('QR generation error', err));
  }, [selectedTableForQr]);

  const handleRegenerateToken = async (tableId: string) => {
    if (!confirm('Ushbu QR kodni yangilasangiz, stoldagi eski qog\'oz/akril QR kod o\'z kuchini yo\'qotadi. Davom etasizmi?')) {
      return;
    }

    setRegeneratingId(tableId);
    try {
      const res = await fetch(`/api/tables/${tableId}/regenerate-qr`, {
        method: 'POST',
      });

      if (!res.ok) {
        alert('QR kodni yangilab bo\'lmadi');
      } else {
        refreshTables();
      }
    } catch {
      alert('Tarmoq xatosi');
    } finally {
      setRegeneratingId(null);
    }
  };

  const handleCreateTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tableNumber || !tableName) return;

    try {
      const payload = {
        branch_id: branchId,
        number: parseInt(tableNumber, 10),
        name: tableName,
        zone: tableZone,
        capacity: parseInt(capacity, 10),
        is_active: true,
      };

      const res = await fetch('/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        refreshTables();
        setIsCreateModalOpen(false);
        setTableNumber('');
        setTableName('');
      } else {
        const d = await res.json();
        alert(d.error || 'Stol qo\'shib bo\'lmadi');
      }
    } catch {
      alert('Tarmoq xatosi');
    }
  };

  const handleCopyLink = (token: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    navigator.clipboard.writeText(`${origin}/t/${token}`);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const handlePrintCard = () => {
    window.print();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-surface-border">
        <div>
          <h1 className="font-serif font-bold text-2xl sm:text-3xl text-white">
            Stollar va Xavfsiz QR Kodlar
          </h1>
          <p className="text-xs text-stone-400 mt-1">
            Har bir stol uchun takrorlanmas QR kodlar yaratish va chop etish (Print).
          </p>
        </div>

        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-gold-400 to-amber-500 text-stone-950 font-bold text-xs shadow-gold-glow hover:brightness-110 active:scale-95 transition-all flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>Yangi Stol Qo&apos;shish</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Stollar ro'yxati */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-surface-100 rounded-2xl border border-surface-border overflow-hidden shadow-luxury">
            <div className="p-4 bg-surface-50 border-b border-surface-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-gold-400" />
                <h2 className="font-serif font-bold text-sm text-white">
                  Mavjud Stollar Ro&apos;yxati ({tables.length} ta)
                </h2>
              </div>
              <span className="text-xs text-stone-400">Filial: Markaziy Filial</span>
            </div>

            <div className="divide-y divide-surface-border/60">
              {tables.map((table) => {
                const isSelected = selectedTableForQr?.id === table.id;

                return (
                  <div
                    key={table.id}
                    onClick={() => setSelectedTableForQr(table)}
                    className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-gold-500/10 border-l-4 border-l-gold-400'
                        : 'hover:bg-surface-200/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-stone-900 border border-surface-border flex flex-col items-center justify-center">
                        <span className="text-[10px] text-stone-500 uppercase font-mono">STOL</span>
                        <span className="font-serif font-bold text-base text-gold-300">
                          {table.number}
                        </span>
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-serif font-bold text-sm text-white">
                            {table.name}
                          </h3>
                          <span className="px-2 py-0.5 rounded bg-surface-50 text-stone-400 text-[10px]">
                            {table.zone || 'Asosiy Zal'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-stone-400 mt-1">
                          <span>Maxsus Token:</span>
                          <code className="px-2 py-0.5 rounded bg-stone-900 text-gold-300 font-mono text-[11px] border border-surface-border">
                            {table.qr_token}
                          </code>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyLink(table.qr_token);
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-surface-50 text-stone-300 hover:text-white border border-surface-border text-xs flex items-center gap-1"
                        title="Havolani ko'chirish"
                      >
                        {copiedToken === table.qr_token ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedToken === table.qr_token ? 'Ko\'chirildi' : 'Havolani ko\'chirish'}</span>
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRegenerateToken(table.id);
                        }}
                        disabled={regeneratingId === table.id}
                        className="px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-300 hover:bg-red-500/20 border border-red-500/30 text-xs flex items-center gap-1"
                        title="QR kodni yangilash"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${regeneratingId === table.id ? 'animate-spin' : ''}`} />
                        <span>Kodni Yangilash</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Chop etish uchun Stend kartasi */}
        <div>
          {selectedTableForQr && (
            <div className="bg-surface-100 rounded-2xl border border-surface-border p-5 shadow-luxury space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-gold-400" />
                  <h3 className="font-serif font-bold text-sm text-white">
                    Stol Stendi Ko&apos;rinishi (Print)
                  </h3>
                </div>
                <button
                  onClick={handlePrintCard}
                  className="px-3 py-1.5 rounded-lg bg-gold-400 text-stone-950 font-bold text-xs hover:bg-gold-300 transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Chop Etish (Print)</span>
                </button>
              </div>

              {/* Akril Stend Kartasi */}
              <div
                ref={printableRef}
                className="p-6 rounded-3xl bg-gradient-to-b from-[#1E1A16] via-[#120F0D] to-[#0A0908] border-2 border-gold-400/60 shadow-2xl text-center space-y-3 relative overflow-hidden"
              >
                <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-gold-400" />
                <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-gold-400" />
                <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-gold-400" />
                <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-gold-400" />

                <div className="font-serif font-black text-xl text-gold-300 tracking-wider uppercase">
                  {restaurant?.name || 'FLAVORIA'}
                </div>
                <div className="text-[10px] text-stone-400 tracking-widest uppercase font-mono">
                  Premium Taomlar & Xizmat
                </div>

                <div className="p-3 bg-white rounded-2xl shadow-xl inline-block mx-auto border-4 border-gold-400/80">
                  {qrDataUrl && (
                    <img
                      src={qrDataUrl}
                      alt={`${selectedTableForQr.number}-stol QR Kodi`}
                      className="w-44 h-44 mx-auto object-contain"
                    />
                  )}
                </div>

                <div className="pt-2">
                  <div className="inline-block px-4 py-1 rounded-full bg-gold-400/20 border border-gold-400/40 text-gold-300 font-serif font-bold text-sm">
                    {selectedTableForQr.name || `${selectedTableForQr.number}-STOL`}
                  </div>
                  <div className="text-[11px] text-stone-300 font-medium mt-1">
                    Kamera orqali skanerlang va menyudan taom tanlang
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-stone-400 leading-relaxed bg-surface-50 p-3 rounded-xl border border-surface-border">
                <ShieldCheck className="w-4 h-4 text-emerald-400 inline mr-1" />
                Agar qog&apos;oz yoki stenddagi QR kod yirtilsa yoki eskirsa, <strong>Kodni Yangilash</strong> tugmasini bosib darhol yangisini chiqaring.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-md bg-surface-100 border border-surface-border rounded-3xl p-6 shadow-2xl animate-slide-up">
            <div className="flex items-center justify-between pb-4 border-b border-surface-border mb-4">
              <h2 className="font-serif font-bold text-lg text-white">Yangi Stol Qo&apos;shish</h2>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="w-8 h-8 rounded-full bg-surface-200 text-stone-300 hover:text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTable} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-stone-300 font-semibold mb-1">Stol Raqami *</label>
                <input
                  type="number"
                  required
                  value={tableNumber}
                  onChange={(e) => setTableNumber(e.target.value)}
                  placeholder="Masalan: 15"
                  className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400"
                />
              </div>

              <div>
                <label className="block text-stone-300 font-semibold mb-1">Stol Nomi / Qayerdaligi *</label>
                <input
                  type="text"
                  required
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  placeholder="Masalan: 15-stol (Terrasa)"
                  className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400"
                />
              </div>

              <div>
                <label className="block text-stone-300 font-semibold mb-1">Zal / Hudud</label>
                <select
                  value={tableZone}
                  onChange={(e) => setTableZone(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400"
                >
                  <option value="Asosiy Zal">Asosiy Zal</option>
                  <option value="Yozgi Terrasa">Yozgi Terrasa</option>
                  <option value="VIP Xona">VIP Alohida Xona</option>
                  <option value="Bar Zonasi">Bar Zonasi</option>
                  <option value="Deraza Yonida">Deraza Yonida</option>
                </select>
              </div>

              <div>
                <label className="block text-stone-300 font-semibold mb-1">O&apos;rindiqlar Soni (Sig&apos;imi)</label>
                <input
                  type="number"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder="4"
                  className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400"
                />
              </div>

              <div className="pt-4 border-t border-surface-border flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-surface-200 text-stone-300 hover:text-white"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-gold-400 text-stone-950 font-bold hover:bg-gold-300"
                >
                  Saqlash & QR Kod Yaratish
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
