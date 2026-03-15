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
  if (disabled || !to) {
    return (
      <span style={style} {...rest}>
        {children}
      </span>
    );
  }

  return (
    <Link
      to={to}
      style={{
        ...BASE_STYLE,
        ...(block ? { display: 'block' } : null),
        ...style,
      }}
      {...rest}
    >
      {children}
    </Link>
  );
}
