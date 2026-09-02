export function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div class="ws-toast" role="status">
      {text}
    </div>
  );
}
