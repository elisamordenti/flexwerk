import { OUTLINE } from '../guide/outline';

export function Learn({ chapter, onChapter, onTryIt }: { chapter: string; onChapter: (id: string) => void; onTryIt: () => void }) {
  const i = Math.max(0, OUTLINE.findIndex((c) => c.id === chapter));
  const c = OUTLINE[i];
  let lastPart = '';
  return (
    <div className="learn">
      <nav aria-label="Guide chapters">
        {OUTLINE.map((ch) => {
          const head = ch.part !== lastPart ? <div className="part">{ch.part}</div> : null;
          lastPart = ch.part;
          return (
            <div key={ch.id}>
              {head}
              <a href={`#learn-${ch.id}`} className={ch.id === c.id ? 'on' : ''} onClick={(e) => { e.preventDefault(); onChapter(ch.id); }}>{ch.title}</a>
            </div>
          );
        })}
      </nav>
      <article>
        <div className="small muted">{c.part}</div>
        <h1 style={{ margin: '4px 0 12px' }}>{c.title}</h1>
        <p>{c.summary}</p>
        <div className="stub">This chapter is being written. Every claim will be cited (with how deeply the source was read) or marked “our own run”, formulas will define every symbol and use numbers from the simulator, and the page will end with a “Try it” link.</div>
        <p><button className="btn" onClick={onTryIt}>Try it in the Lab →</button></p>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 32 }}>
          {i > 0 ? <button className="btn ghost" onClick={() => onChapter(OUTLINE[i - 1].id)}>← {OUTLINE[i - 1].title}</button> : <span />}
          {i < OUTLINE.length - 1 ? <button className="btn ghost" onClick={() => onChapter(OUTLINE[i + 1].id)}>{OUTLINE[i + 1].title} →</button> : <span />}
        </div>
      </article>
    </div>
  );
}
