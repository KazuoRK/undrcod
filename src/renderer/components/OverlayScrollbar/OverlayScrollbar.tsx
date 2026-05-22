/**
 * OverlayScrollbar — scroll-thumb sutil estilo Cursor.
 *
 * Resolve 3 dores das webkit scrollbars nativas:
 *   1. SEMPRE tomam layout space (~6-10px), empurrando conteúdo.
 *   2. Sempre visíveis (não tem auto-hide CSS-only consistente).
 *   3. Estilo varia entre OS (gnomo, blink no win etc).
 *
 * Estratégia (espelho do monaco-scrollable-element do VS Code/Cursor):
 *   - Consumer ESCONDE o scrollbar nativo (scrollbar-width:none + ::-webkit-scrollbar{display:none})
 *   - OverlayScrollbar renderiza thumb próprio `position:absolute` no PARENT do scroll container
 *     (parent precisa ser position:relative)
 *   - JS sync atualiza size+position baseado em scrollLeft/Top, scrollWidth/Height, clientWidth/Height
 *   - Drag horizontal/vertical move scrollLeft/Top proporcionalmente
 *   - Fade-in só quando hover na tabbar
 *
 * IMPORTANTE: thumb tem que ser IRMÃO do scroll container, não filho — senão
 * ele scrolla junto com o conteúdo e o translateX/Y é cancelado pelo scroll
 * nativo.
 */

import { useCallback, useEffect, useRef } from 'react';
import './OverlayScrollbar.css';

interface OverlayScrollbarProps {
  /** Ref pro elemento que tem overflow scroll. */
  targetRef: React.RefObject<HTMLElement | null>;
  /** Orientação do scroll. Default 'horizontal'. */
  orientation?: 'horizontal' | 'vertical';
  /**
   * Tamanho mínimo do thumb (px). Default 32. Garante área de click decente
   * mesmo quando scroll content é gigante (ratio muito pequeno).
   */
  minThumbSize?: number;
  /** Classe extra pra customização local. */
  className?: string;
}

export function OverlayScrollbar({
  targetRef,
  orientation = 'horizontal',
  minThumbSize = 32,
  className = '',
}: OverlayScrollbarProps) {
  const thumbRef = useRef<HTMLDivElement>(null);

  const isHorizontal = orientation === 'horizontal';

  // Sync visual do thumb baseado no estado real do scroll.
  const syncThumb = useCallback(() => {
    const sc = targetRef.current;
    const th = thumbRef.current;
    if (!sc || !th) return;

    if (isHorizontal) {
      const { scrollLeft, scrollWidth, clientWidth } = sc;
      if (scrollWidth <= clientWidth) {
        th.style.display = 'none';
        return;
      }
      th.style.display = 'block';
      const ratio = clientWidth / scrollWidth;
      const thumbW = Math.max(minThumbSize, ratio * clientWidth);
      const maxScroll = scrollWidth - clientWidth;
      const maxThumbX = clientWidth - thumbW;
      const x = maxScroll > 0 ? (scrollLeft / maxScroll) * maxThumbX : 0;
      th.style.width = `${thumbW}px`;
      th.style.transform = `translateX(${x}px)`;
    } else {
      const { scrollTop, scrollHeight, clientHeight } = sc;
      if (scrollHeight <= clientHeight) {
        th.style.display = 'none';
        return;
      }
      th.style.display = 'block';
      const ratio = clientHeight / scrollHeight;
      const thumbH = Math.max(minThumbSize, ratio * clientHeight);
      const maxScroll = scrollHeight - clientHeight;
      const maxThumbY = clientHeight - thumbH;
      const y = maxScroll > 0 ? (scrollTop / maxScroll) * maxThumbY : 0;
      th.style.height = `${thumbH}px`;
      th.style.transform = `translateY(${y}px)`;
    }
  }, [targetRef, isHorizontal, minThumbSize]);

  // Mount: liga scroll listener + ResizeObserver, faz sync inicial.
  useEffect(() => {
    const sc = targetRef.current;
    if (!sc) return;
    const onScroll = (): void => syncThumb();
    sc.addEventListener('scroll', onScroll, { passive: true });
    syncThumb();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => syncThumb());
      ro.observe(sc);
      // Também observa o primeiro filho (conteúdo) — se as tabs mudarem
      // de quantidade/largura, scrollWidth muda e precisamos resync.
      const child = sc.firstElementChild;
      if (child) ro.observe(child);
    }

    // MutationObserver pra casos onde filhos são adicionados/removidos
    // (e.g. nova session aparece) sem disparar ResizeObserver imediatamente.
    const mo = new MutationObserver(() => {
      // microtask delay pra layout estabilizar antes de medir
      queueMicrotask(syncThumb);
    });
    mo.observe(sc, { childList: true, subtree: false });

    return () => {
      sc.removeEventListener('scroll', onScroll);
      ro?.disconnect();
      mo.disconnect();
    };
  }, [targetRef, syncThumb]);

  // Drag — 1px de movimento = (scrollSize/clientSize) px de scroll. Listeners
  // no document pra capturar mousemove fora do thumb.
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      e.preventDefault();
      e.stopPropagation();
      const sc = targetRef.current;
      if (!sc) return;

      const startMouse = isHorizontal ? e.clientX : e.clientY;
      const startScroll = isHorizontal ? sc.scrollLeft : sc.scrollTop;
      const scrollSize = isHorizontal ? sc.scrollWidth : sc.scrollHeight;
      const clientSize = isHorizontal ? sc.clientWidth : sc.clientHeight;
      const ratio = scrollSize / clientSize;

      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';

      const onMove = (ev: MouseEvent): void => {
        const d = (isHorizontal ? ev.clientX : ev.clientY) - startMouse;
        const newScroll = startScroll + d * ratio;
        if (isHorizontal) sc.scrollLeft = newScroll;
        else sc.scrollTop = newScroll;
      };
      const onUp = (): void => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [targetRef, isHorizontal],
  );

  return (
    <div
      className={`overlay-scrollbar overlay-scrollbar-${orientation} ${className}`.trim()}
      ref={thumbRef}
      onMouseDown={handleMouseDown}
      aria-hidden="true"
    />
  );
}
