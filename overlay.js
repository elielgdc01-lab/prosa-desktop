/* Desenha quem está na chamada por cima do jogo. Só lê o estado que o Prosa manda; não clica em nada. */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const okImg = u => typeof u === 'string' && (u.startsWith('data:image/') || u.startsWith('https://ovetqupsrjavyeckbiyg.supabase.co/'));
const MIC_OFF = '<svg viewBox="0 0 24 24"><path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5M5 11a7 7 0 0 0 11.2 5.6M12 18v3M4 4l16 16"/></svg>';
window.prosaOverlay.onState(st => {
  const list = document.getElementById('list');
  if (!st || !st.people?.length) { list.innerHTML = ''; return; }
  list.innerHTML = `<div class="head"><i></i>${esc(st.room || 'Prosa')}</div>` + st.people.map(p => `
    <div class="p ${p.talk ? 'talk' : ''}">
      <span class="av">${okImg(p.img) ? `<img src="${esc(p.img)}" alt="">` : esc((p.name || '?')[0].toUpperCase())}</span>
      <span class="n">${esc(p.name)}</span>${p.mic ? '' : `<span class="m">${MIC_OFF}</span>`}
    </div>`).join('');
});
