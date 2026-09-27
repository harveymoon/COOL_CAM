import { formatDuration } from '@cool-cam/core';

interface Props {
  total: number;
  progress: number;
  setProgress: (v: number) => void;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  speed: number;
  setSpeed: (v: number) => void;
  seconds: number;
  totalSeconds: number;
}

export function Timeline({ total, progress, setProgress, playing, setPlaying, speed, setSpeed, seconds, totalSeconds }: Props) {
  return (
    <div className="timeline">
      <button onClick={() => setPlaying(!playing)} disabled={!total}>{playing ? '❚❚' : '▶'}</button>
      <button onClick={() => { setPlaying(false); setProgress(0); }} disabled={!total}>⏮</button>
      <button onClick={() => { setPlaying(false); setProgress(total); }} disabled={!total}>⏭</button>
      <select value={speed} onChange={e => setSpeed(Number(e.target.value))}>
        {[1, 4, 16, 64, 256].map(s => <option key={s} value={s}>{s}×</option>)}
      </select>
      <input type="range" min={0} max={total} step={1} value={Math.round(progress)} onChange={e => { setPlaying(false); setProgress(Number(e.target.value)); }} />
      <span>{Math.floor(progress)} / {total} moves</span>
      <span>{formatDuration(seconds)} / {formatDuration(totalSeconds)}</span>
    </div>
  );
}
