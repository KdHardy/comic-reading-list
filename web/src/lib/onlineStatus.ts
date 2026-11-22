import { useEffect, useState } from 'react';

/** True when the browser reports network connectivity. */
export function readOnlineStatus(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

/** Subscribe to browser online/offline events. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(readOnlineStatus);

  useEffect(() => {
    function handleOnline() {
      setOnline(true);
    }
    function handleOffline() {
      setOnline(false);
    }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}
