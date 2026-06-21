import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export function AdminDashboard() {
  const { logout } = useAuth();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    window.location.href = '/admin/login';
  };

  const navItems = [
    { path: '/admin/dashboard', label: '仪表盘' },
    { path: '/admin/scheduled-tasks', label: '定时任务' },
    { path: '/admin/settings', label: '配置' },
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f6f7fb' }}>
      {/* Glass Topbar */}
      <header style={{
        height: 64,
        background: 'rgba(255,255,255,0.88)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 32px',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: '#111827' }}>
            <div style={{
              width: 34, height: 34, borderRadius: '50%', background: '#111827', color: 'white',
              display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 700,
            }}>P</div>
            <span style={{ fontWeight: 700, fontSize: 18 }}>PanCheck</span>
          </Link>
          <nav style={{ display: 'flex', gap: 8, marginLeft: 32 }}>
            {navItems.map(item => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  style={{
                    textDecoration: 'none',
                    color: isActive ? 'white' : '#6b7280',
                    padding: '8px 14px',
                    borderRadius: 10,
                    fontSize: 14,
                    background: isActive ? '#111827' : 'transparent',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    if (!isActive) {
                      (e.target as HTMLElement).style.background = '#f3f4f6';
                      (e.target as HTMLElement).style.color = '#111827';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isActive) {
                      (e.target as HTMLElement).style.background = 'transparent';
                      (e.target as HTMLElement).style.color = '#6b7280';
                    }
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <button
          onClick={handleLogout}
          style={{
            border: '1px solid #e5e7eb',
            background: 'white',
            color: '#111827',
            borderRadius: 10,
            padding: '8px 14px',
            cursor: 'pointer',
            fontSize: 14,
          }}
          onMouseEnter={e => (e.target as HTMLElement).style.background = '#f9fafb'}
          onMouseLeave={e => (e.target as HTMLElement).style.background = 'white'}
        >
          退出登录
        </button>
      </header>
      <div style={{ flex: 1, maxWidth: 1280, margin: '0 auto', padding: '28px 32px 40px', width: '100%' }}>
        <Outlet />
      </div>
    </div>
  );
}
