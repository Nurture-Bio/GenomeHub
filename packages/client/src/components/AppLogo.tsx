export function AppLogo({ size = 28 }: { size?: number }) {
  return (
    <span role="img" aria-label="GenomeHub" style={{ fontSize: size, lineHeight: 1 }}>
      🧬
    </span>
  );
}
