import { Grid } from 'antd';

export default function Page({ children, maxWidth = 1200, style }) {
  const screens = Grid.useBreakpoint();
  const padding = screens.md ? 20 : 12;

  return (
    <div
      className="yournote-page"
      style={{
        padding,
        maxWidth,
        margin: '0 auto',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
