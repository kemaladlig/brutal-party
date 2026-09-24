// Tabletop Vector Icons: Neo-Brutalist Arcade Iconography
// OS-bağımsız, jilet gibi net Canvas 2D vektör silüetleri.
// Emojilerin işletim sistemine göre değişen renkli/çizgi film görünümü yerine
// oyunun brutalist görsel diline %100 uyan saf geometri ve dinamik durum renkleri.

/**
 * Belirtilen ikonu verilen Canvas context'inde (x, y) merkezli olarak çizer.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} iconKey - Emojisi ('⚡', '💣', '🚀', '🌀'...) veya ID'si ('dash', 'fire'...)
 * @param {number} cx - Merkez X
 * @param {number} cy - Merkez Y
 * @param {number} size - İkon kutu boyutu (varsayılan 24px)
 * @param {Object} options - Renk ve durum seçenekleri
 */
export function drawTabletopIcon(ctx, iconKey, cx, cy, size = 24, options = {}) {
  const {
    color = '#141416',
    isReady = true,
    accentColor = '#F59E0B',
  } = options;

  const s = size / 24;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, Math.round(2 * s));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const key = String(iconKey || '').trim();

  switch (key) {
    // -------------------------------------------------------------------------
    // 1. DİREKSİYON (SOL & SAĞ)
    // -------------------------------------------------------------------------
    case '◀':
    case 'steer_left': {
      ctx.beginPath();
      ctx.moveTo(cx + 6 * s, cy - 9 * s);
      ctx.lineTo(cx - 7 * s, cy);
      ctx.lineTo(cx + 6 * s, cy + 9 * s);
      ctx.lineTo(cx + 2 * s, cy);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case '▶':
    case 'steer_right': {
      ctx.beginPath();
      ctx.moveTo(cx - 6 * s, cy - 9 * s);
      ctx.lineTo(cx + 7 * s, cy);
      ctx.lineTo(cx - 6 * s, cy + 9 * s);
      ctx.lineTo(cx - 2 * s, cy);
      ctx.closePath();
      ctx.fill();
      break;
    }

    // -------------------------------------------------------------------------
    // 2. DEPAR / ŞİMŞEK (⚡ - Zone, Bomb, Laser)
    // -------------------------------------------------------------------------
    case '⚡':
    case 'dash':
    case 'lightning': {
      ctx.beginPath();
      ctx.moveTo(cx + 2 * s, cy - 10.5 * s);
      ctx.lineTo(cx - 6.5 * s, cy + 0.5 * s);
      ctx.lineTo(cx - 0.5 * s, cy + 0.5 * s);
      ctx.lineTo(cx - 2.5 * s, cy + 10.5 * s);
      ctx.lineTo(cx + 6.5 * s, cy - 0.5 * s);
      ctx.lineTo(cx + 0.5 * s, cy - 0.5 * s);
      ctx.closePath();
      ctx.fill();
      break;
    }

    // -------------------------------------------------------------------------
    // 3. HIZLANMA / ROKET (🚀 - Snake Boost)
    // -------------------------------------------------------------------------
    case '🚀':
    case 'boost':
    case 'rocket': {
      // Roket gövdesi
      ctx.beginPath();
      ctx.moveTo(cx, cy - 11 * s);
      ctx.bezierCurveTo(cx + 5 * s, cy - 7 * s, cx + 5 * s, cy + 3 * s, cx + 3.5 * s, cy + 6 * s);
      ctx.lineTo(cx - 3.5 * s, cy + 6 * s);
      ctx.bezierCurveTo(cx - 5 * s, cy + 3 * s, cx - 5 * s, cy - 7 * s, cx, cy - 11 * s);
      ctx.closePath();
      ctx.fill();

      // Sol ve sağ kanatçıklar
      ctx.beginPath();
      ctx.moveTo(cx - 3.5 * s, cy + 3 * s);
      ctx.lineTo(cx - 8.5 * s, cy + 8 * s);
      ctx.lineTo(cx - 3.5 * s, cy + 6.5 * s);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(cx + 3.5 * s, cy + 3 * s);
      ctx.lineTo(cx + 8.5 * s, cy + 8 * s);
      ctx.lineTo(cx + 3.5 * s, cy + 6.5 * s);
      ctx.closePath();
      ctx.fill();

      // Roket lombozu (penceresi)
      ctx.save();
      ctx.fillStyle = '#FAF7F2';
      ctx.beginPath();
      ctx.arc(cx, cy - 2 * s, 2.2 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Egzoz alevi
      ctx.save();
      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.moveTo(cx - 2.5 * s, cy + 6.5 * s);
      ctx.lineTo(cx, cy + 11 * s);
      ctx.lineTo(cx + 2.5 * s, cy + 6.5 * s);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }

    // -------------------------------------------------------------------------
    // 4. ATEŞ / BOMBA (💣 - Tanks)
    // -------------------------------------------------------------------------
    case '💣':
    case 'fire':
    case 'bomb': {
      // Bomba küresi
      ctx.beginPath();
      ctx.arc(cx - 1 * s, cy + 2 * s, 7.5 * s, 0, Math.PI * 2);
      ctx.fill();

      // Bomba parıltısı (derinlik vurgusu)
      ctx.save();
      ctx.fillStyle = '#FAF7F2';
      ctx.beginPath();
      ctx.arc(cx - 3.5 * s, cy - 0.5 * s, 1.8 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Fitil kapağı
      ctx.fillRect(cx + 2.5 * s, cy - 6 * s, 3.5 * s, 2.5 * s);

      // Kıvrık fitil
      ctx.beginPath();
      ctx.moveTo(cx + 4.2 * s, cy - 6 * s);
      ctx.quadraticCurveTo(cx + 5 * s, cy - 9.5 * s, cx + 8 * s, cy - 8.5 * s);
      ctx.stroke();

      // Yanan kıvılcım (Accent)
      ctx.save();
      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.arc(cx + 8 * s, cy - 8.5 * s, 2.5 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }

    // -------------------------------------------------------------------------
    // 5. NİŞAN / CROSSHAIR (🎯 - Laser)
    // -------------------------------------------------------------------------
    case '🎯':
    case 'target':
    case 'aim': {
      // Dış halka
      ctx.beginPath();
      ctx.arc(cx, cy, 8 * s, 0, Math.PI * 2);
      ctx.stroke();

      // Merkez nokta
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5 * s, 0, Math.PI * 2);
      ctx.fill();

      // 4 Yön Artı Çizgileri
      ctx.beginPath();
      ctx.moveTo(cx - 10.5 * s, cy);
      ctx.lineTo(cx - 5.5 * s, cy);
      ctx.moveTo(cx + 5.5 * s, cy);
      ctx.lineTo(cx + 10.5 * s, cy);
      ctx.moveTo(cx, cy - 10.5 * s);
      ctx.lineTo(cx, cy - 5.5 * s);
      ctx.moveTo(cx, cy + 5.5 * s);
      ctx.lineTo(cx, cy + 10.5 * s);
      ctx.stroke();
      break;
    }

    // -------------------------------------------------------------------------
    // 6. OMUZ / VURUŞ / İMFAZ (💥 - Heist, Crown, Clone)
    // -------------------------------------------------------------------------
    case '💥':
    case 'tackle':
    case 'burst':
    case 'impact': {
      // 10 köşeli agresif patlama yıldızı
      const spikes = 10;
      const outerR = 10.5 * s;
      const innerR = 4.8 * s;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (i * Math.PI) / spikes - Math.PI / 2;
        const px = cx + Math.cos(angle) * r;
        const py = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();

      // İç patlama çekirdeği
      ctx.save();
      ctx.fillStyle = '#FAF7F2';
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }

    // -------------------------------------------------------------------------
    // 7. FALSO / SPİRAL (🌀 - Pong Spin)
    // -------------------------------------------------------------------------
    case '🌀':
    case 'spin':
    case 'vortex': {
      // Çift yönlü aerodinamik fırdöndü / falso girdabı
      ctx.beginPath();
      ctx.arc(cx, cy, 8 * s, 0.2 * Math.PI, 1.1 * Math.PI);
      ctx.stroke();

      // Ok ucu 1
      ctx.beginPath();
      ctx.moveTo(cx - 7 * s, cy - 2 * s);
      ctx.lineTo(cx - 5.5 * s, cy + 6 * s);
      ctx.lineTo(cx - 1.5 * s, cy + 3.5 * s);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, 8 * s, 1.2 * Math.PI, 2.1 * Math.PI);
      ctx.stroke();

      // Ok ucu 2
      ctx.beginPath();
      ctx.moveTo(cx + 7 * s, cy + 2 * s);
      ctx.lineTo(cx + 5.5 * s, cy - 6 * s);
      ctx.lineTo(cx + 1.5 * s, cy - 3.5 * s);
      ctx.closePath();
      ctx.fill();

      // Çekirdek
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5 * s, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    // -------------------------------------------------------------------------
    // 8. KILIÇ / ATILMA (🗡️ - Ninja Strike)
    // -------------------------------------------------------------------------
    case '🗡️':
    case 'action':
    case 'strike':
    case 'sword': {
      // Çapraz Japon katanası
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-Math.PI / 4);

      // Namlu (Blade)
      ctx.beginPath();
      ctx.moveTo(-1.8 * s, -11 * s);
      ctx.lineTo(1.8 * s, -11 * s);
      ctx.lineTo(1.8 * s, 2 * s);
      ctx.lineTo(-1.8 * s, 2 * s);
      ctx.closePath();
      ctx.fill();

      // Uç sivrisi
      ctx.beginPath();
      ctx.moveTo(-1.8 * s, -11 * s);
      ctx.lineTo(0, -14 * s);
      ctx.lineTo(1.8 * s, -11 * s);
      ctx.closePath();
      ctx.fill();

      // Kılıç Kalkanı (Tsuba)
      ctx.fillRect(-5 * s, 2 * s, 10 * s, 2.5 * s);

      // Kabza (Hilt)
      ctx.fillRect(-1.5 * s, 4.5 * s, 3 * s, 7 * s);

      // Topuz (Pommel)
      ctx.beginPath();
      ctx.arc(0, 11.5 * s, 2 * s, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
      break;
    }

    // -------------------------------------------------------------------------
    // 9. SİS BOMBASI / DUMAN (💨 - Ninja Smoke)
    // -------------------------------------------------------------------------
    case '💨':
    case 'smoke': {
      // 3 loblu kabarık sis bulutu
      ctx.beginPath();
      ctx.arc(cx - 2 * s, cy + 1 * s, 6 * s, 0, Math.PI * 2);
      ctx.arc(cx + 4 * s, cy + 2 * s, 4.5 * s, 0, Math.PI * 2);
      ctx.arc(cx + 1 * s, cy - 4 * s, 5 * s, 0, Math.PI * 2);
      ctx.fill();

      // Hız çizgileri (soldan sağa akış)
      ctx.beginPath();
      ctx.moveTo(cx - 10 * s, cy - 2 * s);
      ctx.lineTo(cx - 5 * s, cy - 2 * s);
      ctx.moveTo(cx - 11 * s, cy + 3 * s);
      ctx.lineTo(cx - 7 * s, cy + 3 * s);
      ctx.stroke();
      break;
    }

    // -------------------------------------------------------------------------
    // 10. ZIPLAMA / YAY (🦘 - Collapse Jump)
    // -------------------------------------------------------------------------
    case '🦘':
    case 'jump':
    case 'spring': {
      // Yukarı doğru fırlama oku
      ctx.beginPath();
      ctx.moveTo(cx, cy - 11 * s);
      ctx.lineTo(cx + 7 * s, cy - 4 * s);
      ctx.lineTo(cx + 3 * s, cy - 4 * s);
      ctx.lineTo(cx + 3 * s, cy + 2 * s);
      ctx.lineTo(cx - 3 * s, cy + 2 * s);
      ctx.lineTo(cx - 3 * s, cy - 4 * s);
      ctx.lineTo(cx - 7 * s, cy - 4 * s);
      ctx.closePath();
      ctx.fill();

      // Sıkışmış zıplama yayı (taban)
      ctx.beginPath();
      ctx.moveTo(cx - 5 * s, cy + 4.5 * s);
      ctx.lineTo(cx + 5 * s, cy + 4.5 * s);
      ctx.moveTo(cx - 6 * s, cy + 8 * s);
      ctx.lineTo(cx + 6 * s, cy + 8 * s);
      ctx.moveTo(cx - 7 * s, cy + 11.5 * s);
      ctx.lineTo(cx + 7 * s, cy + 11.5 * s);
      ctx.stroke();
      break;
    }

    // -------------------------------------------------------------------------
    // 11. YAY VE OK (🏹 - Archer Bow)
    // -------------------------------------------------------------------------
    case '🏹':
    case 'bow':
    case 'arrow': {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-Math.PI / 4);

      // Yay yayı (C eğrisi)
      ctx.beginPath();
      ctx.arc(0, 0, 9.5 * s, 0.75 * Math.PI, 1.25 * Math.PI);
      ctx.stroke();

      // Kiriş (düz ip)
      const chordY1 = -9.5 * s * Math.SQRT1_2;
      const chordX1 = -9.5 * s * Math.SQRT1_2;
      const chordY2 = 9.5 * s * Math.SQRT1_2;
      const chordX2 = -9.5 * s * Math.SQRT1_2;
      ctx.lineWidth = Math.max(1, 1.2 * s);
      ctx.beginPath();
      ctx.moveTo(chordX1, chordY1);
      ctx.lineTo(-2 * s, 0); // çekilmiş kiriş
      ctx.lineTo(chordX2, chordY2);
      ctx.stroke();

      // Ok gövdesi ve sivri uç
      ctx.lineWidth = Math.max(1.5, 2 * s);
      ctx.beginPath();
      ctx.moveTo(-2 * s, 0);
      ctx.lineTo(11 * s, 0);
      ctx.stroke();

      // Ok ucu
      ctx.beginPath();
      ctx.moveTo(11 * s, 0);
      ctx.lineTo(6.5 * s, -3.5 * s);
      ctx.lineTo(6.5 * s, 3.5 * s);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
      break;
    }

    // -------------------------------------------------------------------------
    // VARSAYILAN: Unicode Fallback
    // -------------------------------------------------------------------------
    default: {
      ctx.font = `bold ${Math.round(20 * s)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(key, cx, cy + 1);
      break;
    }
  }

  ctx.restore();
}
