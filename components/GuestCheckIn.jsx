import React, { useState } from 'react';

export default function GuestCheckIn() {
  const [formData, setFormData] = useState({ name: '', contact: '' });
  const [pass, setPass] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/checkin/guest-checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await res.json();

      if (data.success) {
        setPass(data.guestPass);
      }
    } catch (err) {
      console.error('Check-in error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#0e0e0e] text-[#e5e2e1] font-['Plus_Jakarta_Sans',sans-serif] selection:bg-[#00f3ff] selection:text-black">
      {/* Top Header */}
      <header className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-4 h-16 bg-[#131313]/80 backdrop-blur-md border-b border-[#3a494b]">
        <div className="flex items-center gap-3">
          <span className="text-[#00f3ff] text-xs font-bold animate-pulse">●</span>
          <h1 className="text-xl font-bold tracking-tight text-white">FASTPASS</h1>
        </div>
        <span className="text-xs font-semibold text-[#00f3ff] px-3 py-1 bg-[#00f3ff]/10 border border-[#00f3ff]/20 rounded-full">
          SYSTEM READY
        </span>
      </header>

      {/* Main Canvas */}
      <main className="flex-grow pt-24 pb-12 flex flex-col items-center justify-center px-4">
        <div className="relative w-full max-w-sm overflow-hidden bg-[#1c1b1b] border border-[#3a494b] rounded-xl shadow-2xl transition-all duration-300">
          
          {/* Emissive Side Accent */}
          <div className="absolute top-0 left-0 w-1.5 h-full bg-[#00f3ff]"></div>

          {!pass ? (
            /* 1. INITIAL ENTRY FORM (Coat Check Register) */
            <div className="p-6">
              <div className="mb-6">
                <p className="text-xs text-[#b9cacb] uppercase tracking-wider mb-1">Check In</p>
                <h2 className="text-2xl font-bold text-white">Claim Your Seat</h2>
                <p className="text-xs text-gray-400 mt-1">Enter your details to check coat & grab access ticket.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs text-[#00f3ff] uppercase font-semibold mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Alex Mercer"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-[#0e0e0e] border border-[#3a494b] focus:border-[#00f3ff] text-white text-sm px-3 py-2.5 rounded-lg outline-none transition"
                  />
                </div>

                <div>
                  <label className="block text-xs text-[#00f3ff] uppercase font-semibold mb-1">Email / Phone</label>
                  <input
                    type="text"
                    required
                    placeholder="alex@domain.com"
                    value={formData.contact}
                    onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
                    className="w-full bg-[#0e0e0e] border border-[#3a494b] focus:border-[#00f3ff] text-white text-sm px-3 py-2.5 rounded-lg outline-none transition"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 bg-[#00f3ff] hover:bg-[#00dce6] text-black font-bold text-sm py-3 rounded-lg shadow-[0_0_15px_rgba(0,243,255,0.3)] transition active:scale-95"
                >
                  {loading ? 'VALIDATING...' : 'CHECK COAT & CLAIM SEAT'}
                </button>
              </form>
            </div>
          ) : (
            /* 2. DIGITAL TICKET STUB (Stitch Output) */
            <div>
              <div className="p-6 border-b border-dashed border-[#3a494b]">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <p className="text-xs text-[#b9cacb] uppercase tracking-wider mb-1">Status</p>
                    <p className="text-sm text-[#00f3ff] font-bold flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#00f3ff] animate-pulse"></span>
                      VALIDATED
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-[#b9cacb] uppercase tracking-wider mb-1">Entry Time</p>
                    <p className="text-sm font-medium text-white">NOW</p>
                  </div>
                </div>

                <div className="space-y-4 py-2">
                  <div>
                    <p className="text-xs text-[#b9cacb] uppercase tracking-wider mb-1">Zone & Allocation</p>
                    <p className="text-2xl text-white font-bold tracking-tight">Lounge 01</p>
                  </div>
                  <div className="flex justify-between items-end">
                    <div>
                      <p className="text-xs text-[#b9cacb] uppercase tracking-wider mb-1">Claim ID</p>
                      <p className="text-3xl text-[#00f3ff] font-bold tracking-tighter">#{pass.passId}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[#b9cacb] uppercase tracking-wider">Guest</p>
                      <p className="text-sm font-semibold text-white">{pass.name}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* QR Code Ticket Section */}
              <div className="relative bg-[#0e0e0e] p-8 flex flex-col items-center">
                <div className="w-6 h-6 bg-[#131313] rounded-full absolute -left-3 top-1/2 -translate-y-1/2"></div>
                <div className="w-6 h-6 bg-[#131313] rounded-full absolute -right-3 top-1/2 -translate-y-1/2"></div>

                <div className="relative p-4 bg-white/5 border border-[#3a494b] rounded-lg">
                  <div className="w-40 h-40 bg-white p-2 rounded shadow-inner flex items-center justify-center">
                    <div className="text-black text-center font-bold text-xs border-2 border-black p-2">
                      [ SCAN AT DOOR ]
                    </div>
                  </div>
                </div>
                <p className="mt-6 text-xs text-[#b9cacb] tracking-[0.2em] uppercase font-medium">Secured Encryption</p>
              </div>

              {/* Ticket Footer */}
              <div className="px-6 py-4 bg-[#201f1f] flex justify-between items-center">
                <div className="flex gap-1.5">
                  <div className="w-1.5 h-3.5 bg-[#00f3ff] rounded-full"></div>
                  <div className="w-1.5 h-3.5 bg-[#00f3ff]/50 rounded-full"></div>
                  <div className="w-1.5 h-3.5 bg-[#00f3ff]/20 rounded-full"></div>
                </div>
                <p className="text-xs text-[#b9cacb] font-semibold">PRIORITY LEVEL 05</p>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
