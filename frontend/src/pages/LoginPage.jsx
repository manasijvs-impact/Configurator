import React, { useState } from 'react';

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!email || !password) {
      setError('Please enter email and password');
      setLoading(false);
      return;
    }

    setTimeout(() => {
      if (email.includes('@impactanalytics.co')) {
        onLogin({
          email,
          name: email.split('@')[0].replace('.', ' ').replace(/\b\w/g, c => c.toUpperCase())
        });
        // Don't setLoading(false) - component will unmount after successful login
      } else {
        setError('Please use your Impact Analytics email');
        setLoading(false);
      }
    }, 500);
  };

  // Full Impact Analytics logo SVG
  const ImpactLogo = () => (
    <svg width="140" height="28" viewBox="0 0 78 27" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M13.6094 10.1389L5.6875 25.8834L0 21.7299L7.87771 5.90102L13.5122 10.0545L13.6182 10.1305L13.6094 10.1389ZM16.5591 4.2717L10.8186 0L8.45176 4.7529L14.1834 9.00771L16.5679 4.28014L16.5591 4.2717ZM17.6454 6.42443L11.8166 18.0914L27.36 26.1874L17.6542 6.42443H17.6454Z" fill="#264CD7"/>
      <path d="M77.9911 7.28503H75.1385V14.6887H73.434V7.28503H70.5991V5.85831H71.0142C73.2044 5.85831 75.3946 5.85831 77.5848 5.85831C77.7262 5.85831 77.8586 5.84987 77.9999 5.84143V7.28503H77.9911Z" fill="#1C1B1B" fillOpacity="0.982"/>
      <path d="M77.991 19.7708C77.6554 20.4124 77.0725 20.6404 76.1629 20.4715C75.9421 20.4293 75.7302 20.3533 75.4917 20.2774C75.5624 20.0832 75.6242 19.9312 75.6772 19.8046C76.0304 19.8637 76.366 19.9397 76.7016 19.9566C76.9577 19.9735 77.2227 19.9059 77.2933 19.6189C77.364 19.3234 77.1344 19.1799 76.9047 19.0702C76.6575 18.952 76.3925 18.8844 76.1452 18.7662C75.7125 18.5721 75.5359 18.2513 75.5888 17.8123C75.633 17.4155 75.8979 17.12 76.3395 17.0103C76.8518 16.8837 77.3375 16.9427 77.8232 17.1791C77.7614 17.348 77.6996 17.4999 77.6466 17.635C77.3463 17.5843 77.0725 17.5253 76.7899 17.5084C76.5691 17.4915 76.3395 17.559 76.2777 17.8038C76.2159 18.0487 76.3837 18.1922 76.5868 18.2935C76.7369 18.3695 76.8959 18.4286 77.0637 18.4792C77.4788 18.6227 77.8232 18.8338 77.991 19.239V19.7624V19.7708Z" fill="#1C1B1B" fillOpacity="0.982"/>
      <path d="M35.8559 5.85809C36.4211 5.85809 36.8803 5.84121 37.3396 5.86653C37.4456 5.86653 37.5869 6.01005 37.6399 6.11979C38.3817 7.59716 39.1147 9.08297 39.8477 10.5603C39.9979 10.8642 40.1303 11.1766 40.307 11.5396C40.5896 10.9149 40.8369 10.3408 41.1106 9.78366C41.7112 8.55956 42.3382 7.33546 42.9388 6.11135C43.0447 5.9003 43.1861 5.83276 43.4157 5.84121C43.8043 5.85809 44.1928 5.84121 44.6786 5.84121C44.917 8.78749 45.1466 11.7169 45.3939 14.7054C44.8375 14.7054 44.3341 14.7138 43.8396 14.6885C43.7778 14.6885 43.6718 14.5028 43.6718 14.4015C43.61 13.1689 43.5746 11.928 43.5128 10.6954C43.4775 10.02 43.4157 9.34467 43.3627 8.66931C43.3627 8.61865 43.3362 8.568 43.3009 8.43293C43.0889 8.85503 42.9123 9.2096 42.7445 9.55572C42.1704 10.7967 41.5964 12.0377 41.0312 13.2787C40.9517 13.456 40.8634 13.5235 40.6514 13.5235C39.6446 13.5235 39.6446 13.5319 39.2472 12.6709C38.6731 11.4214 38.0814 10.172 37.4986 8.92257C37.4279 8.77905 37.3484 8.63554 37.2778 8.49202C37.2424 8.49202 37.2071 8.49202 37.1718 8.50046C37.0658 10.5519 36.951 12.5949 36.845 14.6716H35.1582C35.3878 11.7253 35.6263 8.80438 35.8559 5.83276V5.85809Z" fill="#1C1B1B" fillOpacity="0.982"/>
      <path d="M53.3692 14.7221C53.7843 13.6415 54.1552 12.6031 54.5791 11.5901C55.3475 9.77502 56.1512 7.97685 56.9283 6.17025C57.0255 5.94231 57.1579 5.80724 57.4317 5.85789C57.5289 5.87477 57.6437 5.87477 57.7408 5.85789C58.5092 5.69749 58.8624 6.05206 59.1274 6.71054C60.1695 9.30226 61.2558 11.8771 62.3244 14.4519C62.3509 14.5195 62.3685 14.5955 62.4039 14.7136C61.821 14.7136 61.2646 14.7136 60.7082 14.7052C60.6376 14.7052 60.5404 14.587 60.5051 14.5026C60.2843 13.9623 60.0812 13.422 59.8869 12.8733C59.8251 12.696 59.7367 12.6369 59.5425 12.6369C58.4209 12.6369 57.2904 12.6369 56.1688 12.6369C55.9569 12.6369 55.8685 12.7044 55.7979 12.8901C55.6213 13.422 55.4093 13.9454 55.2327 14.4688C55.1709 14.6461 55.0825 14.7305 54.8706 14.7305C54.3937 14.7136 53.9079 14.7305 53.3516 14.7305L53.3692 14.7221ZM56.3366 11.3115H59.3923C58.8889 10.062 58.3944 8.85483 57.9086 7.65605C57.8733 7.65605 57.8468 7.65605 57.8115 7.6645C57.3257 8.86327 56.84 10.062 56.3366 11.3115Z" fill="#1C1B1B" fillOpacity="0.982"/>
      <path d="M48.6882 11.641V14.697H47.0278V5.95101C47.6195 5.90035 48.2201 5.81593 48.8295 5.79061C49.8804 5.7484 50.9402 5.7484 51.9558 6.10296C53.9252 6.78677 54.4905 9.35317 52.9538 10.7039C52.2826 11.2948 51.4259 11.4806 50.5516 11.5566C49.9511 11.6072 49.3417 11.6156 48.6882 11.641ZM48.7058 10.2058C49.5095 10.2311 50.2867 10.2565 51.0373 10.0201C51.7174 9.80904 52.0176 9.38694 52.0265 8.68624C52.0265 8.01088 51.6997 7.555 51.0373 7.35239C50.2778 7.11601 49.5095 7.14134 48.7147 7.22576V10.2058H48.7058Z" fill="#1C1B1B" fillOpacity="0.982"/>
      <path d="M69.6715 12.9751C69.8304 13.4479 69.9806 13.8615 70.1484 14.368C69.6008 14.52 69.0974 14.6888 68.5764 14.7901C67.7197 14.959 66.8454 14.9674 65.9799 14.7901C64.5492 14.5031 63.5601 13.7011 63.0832 12.3926C62.5356 10.9068 62.5091 9.4041 63.2421 7.95206C63.9928 6.45781 65.3175 5.74867 67.0044 5.65581C67.9405 5.60516 68.8502 5.75712 69.7156 6.13701C69.9629 6.24676 70.0424 6.3565 69.9276 6.60977C69.7775 6.93057 69.6715 7.25981 69.5567 7.56372C69.0268 7.42021 68.5234 7.22604 68.0023 7.15006C65.9799 6.87147 64.6993 7.85075 64.5139 9.79243C64.4432 10.4931 64.5139 11.1938 64.77 11.8607C65.1674 12.8654 66.0417 13.4394 67.1722 13.4647C68.0376 13.4901 68.859 13.355 69.6803 12.9667L69.6715 12.9751Z" fill="#1C1B1B" fillOpacity="0.982"/>
      <path d="M31.8643 5.87537H33.4981V14.6973H31.8643V5.87537Z" fill="#1C1B1B" fillOpacity="0.982"/>
      <path d="M40.466 19.1879V17.0605H41.0842V20.412C40.7575 20.488 40.5455 20.4374 40.3512 20.125C39.9096 19.4243 39.4062 18.7658 38.9205 18.082C38.8852 18.0905 38.8587 18.0989 38.8234 18.1073V20.412H38.1875V17.0521C38.4966 16.9761 38.7439 17.0014 38.947 17.2716C39.4239 17.8963 39.9273 18.5041 40.466 19.171V19.1879Z" fill="#1C1B1B" fillOpacity="0.982"/>
      <path d="M43.9546 20.4041C44.4227 19.3151 44.8642 18.2599 45.3323 17.2215C45.3765 17.1286 45.5531 17.0526 45.6767 17.0442C45.818 17.0442 46.0565 17.0948 46.1006 17.1877C46.5599 18.2261 46.9838 19.2645 47.4165 20.3113C47.4254 20.3366 47.4165 20.3788 47.4165 20.4886C47.1693 20.4295 46.8778 20.4464 46.7365 20.3113C46.5775 20.1593 46.5422 19.8807 46.4451 19.6444C46.0035 19.6444 45.5708 19.6444 45.138 19.6444C45.0585 19.6444 44.979 19.7288 44.9172 19.7879C44.8819 19.8216 44.8731 19.8892 44.8554 19.9398C44.72 20.3056 44.4197 20.4576 43.9546 20.3957V20.4041ZM46.2773 19.1125C46.0918 18.6566 45.9152 18.2261 45.7474 17.804C45.7209 17.804 45.6944 17.804 45.6679 17.804C45.4913 18.2345 45.3235 18.6651 45.138 19.1125H46.2861H46.2773Z" fill="#1C1B1B" fillOpacity="0.982"/>
      <path d="M35.3614 20.4377C35.1583 20.4377 35.0258 20.4208 34.911 20.4377C34.6725 20.4715 34.5666 20.3617 34.4959 20.1591C34.3105 19.6357 34.3016 19.6357 33.7276 19.6357C33.6569 19.6357 33.5863 19.6357 33.5245 19.6357C32.8621 19.6357 32.8533 19.6357 32.606 20.2351C32.4558 20.6065 32.1556 20.3448 31.8995 20.4546C31.8995 20.3786 31.8818 20.3279 31.8995 20.2857C32.3234 19.2642 32.7473 18.2343 33.1889 17.2128C33.2242 17.1284 33.3831 17.0271 33.4891 17.0355C33.6481 17.0355 33.9042 17.0777 33.9484 17.179C34.4341 18.2343 34.8845 19.3064 35.3702 20.4377H35.3614ZM32.9946 19.1038H34.1338C33.9484 18.6395 33.7717 18.209 33.5598 17.694C33.3567 18.209 33.18 18.6395 32.9857 19.1038H32.9946Z" fill="#1C1B1B" fillOpacity="0.982"/>
      <path d="M72.7011 17.2296C72.6393 17.3984 72.5775 17.542 72.5157 17.6939C71.8886 17.4997 71.2793 17.3393 70.8023 17.9303C70.4756 18.344 70.4756 19.1713 70.82 19.5765C71.3057 20.1506 71.9151 19.9733 72.5598 19.7875C72.6128 19.9479 72.6746 20.0999 72.7276 20.2603C71.9769 20.6993 70.8112 20.5727 70.299 20.007C69.7426 19.3823 69.7514 18.1498 70.3254 17.4997C70.8377 16.9172 71.8886 16.7822 72.6923 17.2296H72.7011Z" fill="#1C1B1B" fillOpacity="0.982"/>
      <path d="M56.4687 20.4206H55.8152C55.8152 20.1927 55.7975 19.9647 55.8152 19.7452C55.8593 19.3062 55.718 18.9432 55.4707 18.5887C55.1351 18.1075 54.8613 17.6009 54.5522 17.0944C55.1616 16.934 55.2676 16.9847 55.5237 17.449C55.7092 17.7951 55.9123 18.1328 56.1508 18.5464C56.3892 18.1412 56.6012 17.7951 56.7954 17.4405C57.0604 16.9593 57.0604 16.9593 57.7228 17.0775C57.4313 17.5587 57.184 18.0484 56.8573 18.4958C56.5482 18.9263 56.4069 19.3653 56.4687 19.8719C56.4863 20.0407 56.4687 20.218 56.4687 20.429V20.4206Z" fill="#1C1B1B" fillOpacity="0.982"/>
      <path d="M62.1295 20.4209H61.4583V17.5928H60.3809V17.0525H63.1628V17.5843H62.1295V20.4209Z" fill="#1C1B1B" fillOpacity="0.982"/>
      <path d="M52.5649 19.889V20.4124H50.3306V17.0525H50.9841V19.889H52.5649Z" fill="#1C1B1B" fillOpacity="0.982"/>
      <path d="M66.1484 17.0442H66.7401V20.4126H66.1484V17.0442Z" fill="#1C1B1B" fillOpacity="0.982"/>
    </svg>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      {/* Top Header Bar */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        padding: '20px 40px',
        background: '#fff',
        borderBottom: '1px solid #f1f5f9'
      }}>
        <ImpactLogo />
        <span style={{ fontSize: '14px', color: '#1a1a2e', fontWeight: '500' }}>Smart Platform</span>
      </div>

      {/* Main Content */}
      <div style={{ display: 'flex', flex: 1 }}>
        {/* Left Side - Login Form */}
        <div style={{ 
          flex: '0 0 50%', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          padding: '40px 60px',
          background: '#fff'
        }}>
          <div style={{ 
            width: '100%', 
            maxWidth: '340px',
            padding: '40px',
            background: '#fff',
            borderRadius: '8px',
            border: '1px solid #e2e8f0'
          }}>
            <h1 style={{ margin: '0 0 36px', fontSize: '22px', fontWeight: '500', color: '#1a1a2e' }}>
              Sign in to your accounts
            </h1>

            <form onSubmit={handleSubmit}>
              {/* Name/Email Field */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: '#64748b' }}>
                  Name
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="E-mail"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '4px',
                    border: '1px solid #e2e8f0',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                    outline: 'none',
                    color: '#1a1a2e'
                  }}
                />
              </div>

              {/* Password Field */}
              <div style={{ marginBottom: '6px' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: '#64748b' }}>
                  Password
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    style={{
                      width: '100%',
                      padding: '10px 36px 10px 12px',
                      borderRadius: '4px',
                      border: '1px solid #e2e8f0',
                      fontSize: '13px',
                      boxSizing: 'border-box',
                      outline: 'none',
                      color: '#1a1a2e'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                      color: '#94a3b8'
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {showPassword ? (
                        <>
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </>
                      ) : (
                        <>
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                          <line x1="1" y1="1" x2="23" y2="23"/>
                        </>
                      )}
                    </svg>
                  </button>
                </div>
              </div>

              {/* Forgot Password */}
              <div style={{ textAlign: 'right', marginBottom: '20px' }}>
                <a href="#" style={{ fontSize: '12px', color: '#2563eb', textDecoration: 'none' }}>
                  Forgot Password?
                </a>
              </div>

              {/* Error Message */}
              {error && (
                <p style={{ color: '#dc2626', fontSize: '13px', textAlign: 'center', marginBottom: '16px' }}>
                  {error}
                </p>
              )}

              {/* Sign In Button */}
              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '4px',
                  border: 'none',
                  background: '#2563eb',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: '500',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.7 : 1,
                  marginBottom: '20px'
                }}
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </button>

              {/* Divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }}></div>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>or continue with</span>
                <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }}></div>
              </div>

              {/* Google Sign In */}
              <button
                type="button"
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '4px',
                  border: '1px solid #e2e8f0',
                  background: '#fff',
                  fontSize: '13px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  color: '#1a1a2e'
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Google
              </button>
            </form>

            {/* Help Link */}
            <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '12px', color: '#64748b' }}>
              Need any help? <a href="#" style={{ color: '#2563eb', textDecoration: 'none' }}>Contact now</a>
            </p>
          </div>
        </div>

        {/* Right Side - Hero Section */}
        <div style={{ 
          flex: '0 0 50%', 
          background: 'linear-gradient(180deg, #e8f4fc 0%, #d4e8f7 50%, #c7dff0 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px 40px',
          position: 'relative',
          overflow: 'hidden'
        }}>
          {/* Background Pattern - subtle network dots */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage: `
              radial-gradient(circle at 10% 20%, rgba(59, 130, 246, 0.08) 0%, transparent 30%),
              radial-gradient(circle at 90% 80%, rgba(59, 130, 246, 0.08) 0%, transparent 30%),
              radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.05) 0%, transparent 50%)
            `,
            pointerEvents: 'none'
          }}></div>

          {/* Content */}
          <div style={{ position: 'relative', textAlign: 'center', maxWidth: '480px' }}>
            <h2 style={{ 
              fontSize: '28px', 
              fontWeight: '400', 
              color: '#1a1a2e', 
              marginBottom: '40px',
              lineHeight: '1.4'
            }}>
              Powering the AI in Retail
            </h2>

            {/* Mac with Dashboard */}
            <div style={{ display: 'inline-block' }}>
              {/* iMac Frame */}
              <div style={{
                background: '#1a1a2e',
                borderRadius: '16px 16px 0 0',
                padding: '12px 12px 0 12px',
                boxShadow: '0 25px 50px rgba(0,0,0,0.2)'
              }}>
                {/* Screen */}
                <div style={{
                  background: '#f8f9fb',
                  borderRadius: '6px',
                  padding: '16px',
                  width: '320px',
                  minHeight: '200px'
                }}>
                  {/* Dashboard Header */}
                  <div style={{ fontSize: '9px', color: '#64748b', marginBottom: '10px', fontWeight: '500' }}>Your Active Products</div>
                  
                  {/* Product Cards Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '14px' }}>
                    {[
                      { name: 'PriceSmart', color: '#f97316', icon: '📊' },
                      { name: 'AssortSmart', color: '#3b82f6', icon: '📦' },
                      { name: 'AllocationSmart', color: '#ef4444', icon: '🎯' },
                      { name: 'MarkSmart', color: '#10b981', icon: '💰' },
                    ].map((product, i) => (
                      <div key={i} style={{ 
                        background: '#fff', 
                        borderRadius: '6px', 
                        padding: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.08)'
                      }}>
                        <div style={{ 
                          width: '22px', 
                          height: '22px', 
                          background: product.color,
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '11px'
                        }}>{product.icon}</div>
                        <span style={{ fontSize: '8px', fontWeight: '500', color: '#1a1a2e' }}>{product.name}</span>
                      </div>
                    ))}
                  </div>
                  
                  {/* Other Products Section */}
                  <div style={{ fontSize: '8px', color: '#64748b', marginBottom: '8px', fontWeight: '500' }}>Other Products</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                    {['AttributeSmart', 'FitSmart', 'InventorySmart', 'TradeSmart', 'PlanSmart', 'SpaceSmart', 'AuditSmart', 'PackSmart', 'JDA'].map((name, i) => (
                      <div key={i} style={{ 
                        background: '#fff', 
                        borderRadius: '4px', 
                        padding: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                      }}>
                        <div style={{ 
                          width: '16px', 
                          height: '16px', 
                          background: '#e2e8f0',
                          borderRadius: '3px'
                        }}></div>
                        <span style={{ fontSize: '6px', color: '#64748b' }}>{name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Chin with Apple logo */}
              <div style={{
                background: 'linear-gradient(to bottom, #e8e8e8, #d0d0d0)',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '0 0 2px 2px'
              }}>
                <svg width="14" height="17" viewBox="0 0 14 17" fill="#555">
                  <path d="M13.1 12.4c-.3.6-.6 1.2-1.1 1.7-.6.7-1.2 1.1-1.8 1.1-.4 0-1-.1-1.7-.4-.7-.3-1.3-.4-1.7-.4-.5 0-1 .1-1.7.4-.7.3-1.2.4-1.6.4-.7 0-1.4-.4-2-1.2C.5 12.7 0 11.2 0 9.7c0-1.4.3-2.5.9-3.4.7-1 1.6-1.5 2.7-1.5.5 0 1.2.2 2 .5.8.3 1.2.5 1.4.5.2 0 .7-.2 1.5-.5.8-.3 1.5-.5 2-.5 1.5.1 2.6.9 3.4 2.2-1.3.8-2 1.9-2 3.4 0 1.2.4 2.1 1.2 2.8.4.3.8.6 1.2.8-.1.3-.2.5-.2.4zM9.5 0c0 .9-.3 1.7-.9 2.4-.7.9-1.6 1.3-2.5 1.2 0-.1 0-.2 0-.3 0-.9.4-1.8 1-2.4.3-.3.7-.6 1.3-.9.5-.2 1-.4 1.4-.4 0 .1 0 .3-.3.4z"/>
                </svg>
              </div>
              
              {/* Stand */}
              <div style={{
                width: '80px',
                height: '55px',
                background: 'linear-gradient(to bottom, #d0d0d0, #b8b8b8)',
                margin: '0 auto',
                clipPath: 'polygon(15% 0%, 85% 0%, 100% 100%, 0% 100%)'
              }}></div>
              <div style={{
                width: '120px',
                height: '10px',
                background: 'linear-gradient(to bottom, #c0c0c0, #a0a0a0)',
                margin: '0 auto',
                borderRadius: '0 0 8px 8px'
              }}></div>
            </div>

            {/* Carousel Dots */}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '30px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#2563eb' }}></div>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#cbd5e1' }}></div>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#cbd5e1' }}></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
