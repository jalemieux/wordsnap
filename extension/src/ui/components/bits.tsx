import type { Source } from '../../shared/schemas';

export function Chip({ status, label }: { status: string; label: string }) {
  return (
    <span class="ws-chip" data-status={status}>
      {label}
    </span>
  );
}

const CONF = ['', 'very low', 'low', 'moderate', 'high', 'high'];

export function Meter({ n }: { n: number }) {
  return (
    <>
      <span class="ws-meter" role="img" aria-label={`Confidence ${n} of 5`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <i key={i} class={i <= n ? 'on' : ''} />
        ))}
      </span>
      <span class="ws-meter-l">{CONF[n] ?? ''}</span>
    </>
  );
}

export function Sources({ list }: { list: Source[] }) {
  if (!list.length) return null;
  return (
    <>
      {list.map((s) => (
        <div class="ws-src" key={s.url}>
          {s.publisher ? <b>{s.publisher}</b> : null}
          <a href={s.url} target="_blank" rel="noopener noreferrer">
            {s.title}
          </a>
          {s.date ? <span>{s.date}</span> : null}
        </div>
      ))}
    </>
  );
}

export function Mark({ small }: { small?: boolean }) {
  return <span class={`ws-mark${small ? ' sm' : ''}`}>W</span>;
}
