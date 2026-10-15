'use client';

import { useEffect, useState } from 'react';

export default function DatabaseNotice() {
  const [reloadRequired, setReloadRequired] = useState(false);
  useEffect(() => {
    const onBlocked = () => setReloadRequired(true);
    window.addEventListener('readme-db-blocked', onBlocked);
    return () => window.removeEventListener('readme-db-blocked', onBlocked);
  }, []);
  return reloadRequired ? <div className="database-notice" role="alert">Please reload this tab.</div> : null;
}
