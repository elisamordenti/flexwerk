/** Simple line icons per asset type (own drawings, 32x32 box). */
export function AssetIcon({ name, size = 28, color = '#52514e' }: { name: string; size?: number; color?: string }) {
  const s = { fill: 'none', stroke: color, strokeWidth: 1.8, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  const body = (() => {
    switch (name) {
      case 'factory':
        return (<g {...s}><path d="M4 27V14l7 4v-4l7 4v-4l7 4V6h3v21z" /><path d="M8 22h3M15 22h3M22 22h3" /></g>);
      case 'solar':
        return (<g {...s}><path d="M5 22l4-11h18l-4 11z" /><path d="M11.5 11l-2 11M17.5 11l-1.5 11M23 11l-1.2 11M7 16.5h18.5" /><path d="M16 22v5M11 27h10" /></g>);
      case 'battery':
        return (<g {...s}><rect x="7" y="7" width="18" height="21" rx="2.5" /><path d="M12 4h8" /><path d="M17 11l-4 6h6l-4 6" /></g>);
      case 'pylon':
        return (<g {...s}><path d="M16 3l-6 25M16 3l6 25M11.5 21h9M12.8 15h6.4M14 9h4" /><path d="M6 9h20M8 15h16" /></g>);
      case 'charger':
        return (<g {...s}><rect x="6" y="5" width="13" height="22" rx="2" /><path d="M9 10h7" /><path d="M13 14l-2 4h4l-2 4" /><path d="M19 12h3a3 3 0 0 1 3 3v6a2 2 0 0 0 4 0v-9" /></g>);
      case 'heatpump':
        return (<g {...s}><rect x="4" y="7" width="24" height="18" rx="2" /><circle cx="13" cy="16" r="5" /><path d="M13 11v10M8 16h10" /><path d="M22 11h3M22 15h3M22 19h3" /></g>);
      case 'chp':
        return (<g {...s}><rect x="4" y="12" width="20" height="14" rx="2" /><path d="M24 17h4v4h-4M9 12V8h5v4" /><path d="M10 19h8" /></g>);
      default:
        return (<g {...s}><circle cx="16" cy="16" r="10" /></g>);
    }
  })();
  return <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">{body}</svg>;
}
