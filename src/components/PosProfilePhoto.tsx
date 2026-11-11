import { useRef, useState } from 'react';
import { UserRound, X } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { fileToStoreLogoDataUrl } from '@/lib/productImage';
import { triggerAutoSync } from '@/lib/sync';

function hasPhoto(url?: string | null): boolean {
  return Boolean(url && url.startsWith('data:image/'));
}

/**
 * The signed-in person's photo on the POS.
 * Owners and cashiers each save their own. The store name stays off this screen.
 */
export default function PosProfilePhoto() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const setMyPhoto = useAuthStore((state) => state.setMyPhoto);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const photo = hasPhoto(currentUser?.photo_url) ? currentUser!.photo_url! : '';
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const choose = () => {
    if (!busy) inputRef.current?.click();
  };

  const onFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setMessage('');
    try {
      const dataUrl = await fileToStoreLogoDataUrl(file);
      await setMyPhoto(dataUrl);
      setMessage('Photo saved');
      void triggerAutoSync('profile-photo');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Could not save this photo');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    setMessage('');
    try {
      await setMyPhoto('');
      setMessage('Photo removed');
      void triggerAutoSync('profile-photo');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Could not remove this photo');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pos-profile">
      <button
        type="button"
        className="pos-profile-photo"
        onClick={choose}
        disabled={busy}
        aria-label={photo ? 'Change your profile photo' : 'Upload your profile photo'}
      >
        {photo ? <img src={photo} alt="" /> : <UserRound className="h-5 w-5" aria-hidden="true" />}
      </button>
      <div className="min-w-0">
        <p className="pos-profile-label">Your photo</p>
        <p className="pos-profile-date" role="status">{busy ? 'Saving photo…' : message || today}</p>
      </div>
      {photo && (
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          aria-label="Remove your profile photo"
          className="pos-profile-remove"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => void onFile(event.target.files?.[0] || null)}
      />
    </div>
  );
}
