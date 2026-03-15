import { Link } from 'react-router-dom';

const BASE_STYLE = {
  color: 'inherit',
  textDecoration: 'none',
};

export default function AppLink({
  to,
  children,
  block = false,
  disabled = false,
  style,
  ...rest
}) {
  const mergedStyle = {
    ...BASE_STYLE,
    ...(block ? { display: 'block', width: '100%', minWidth: 0, flex: '1 1 auto' } : null),
    ...style,
  };

  if (disabled || !to) {
    return (
      <span style={mergedStyle} {...rest}>
        {children}
      </span>
    );
  }

  return (
    <Link
      to={to}
      style={mergedStyle}
      {...rest}
    >
      {children}
    </Link>
  );
}
