import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Clock3, Monitor, RefreshCw, Search, Smartphone, Tablet, Users } from 'lucide-react';
import { loadActiveDeviceSessions, type ActiveDeviceSession } from '@/lib/devicePresence';

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function deviceIcon(type: ActiveDeviceSession['device_type']) {
  if (type === 'Phone') return Smartphone;
  if (type === 'Tablet') return Tablet;
  return Monitor;
}

export default function AdminActiveDevicesPanel() {
  const [devices, setDevices] = useState<ActiveDeviceSession[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setDevices(await loadActiveDeviceSessions());
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load active device sessions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(true), 30_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const filteredDevices = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return devices;
    return devices.filter((device) =>
      [
        device.user_name,
        device.role,
        device.store_name,
        device.browser,
        device.operating_system,
        device.device_type,
      ].some((value) => value.toLowerCase().includes(search))
    );
  }, [devices, query]);
  const uniqueUsers = new Set(devices.map((device) => device.user_id)).size;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Active user devices</h2>
          <p className="mt-1 text-xs text-slate-500">
            Browsers are shown as active when they check in within the last 3 minutes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-emerald-100 bg-white p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <Activity className="h-4 w-4 text-emerald-700" />
            Active sessions
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{devices.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <Users className="h-4 w-4 text-slate-600" />
            Users online
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{uniqueUsers}</p>
        </div>
      </div>

      <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <Search className="h-4 w-4 text-slate-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search user, store, browser, or device"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>

      {error && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {error}
        </div>
      )}

      {loading && devices.length === 0 ? (
        <div className="rounded-2xl bg-white py-12 text-center text-sm text-slate-500">
          <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />
          Loading active devices…
        </div>
      ) : filteredDevices.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-500">
          {query ? 'No active devices match that search.' : 'No users have checked in recently.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredDevices.map((device) => {
            const DeviceIcon = deviceIcon(device.device_type);
            return (
              <article
                key={device.session_id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800">
                    <DeviceIcon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-900">{device.user_name}</p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {device.store_name} · {device.role}
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-800">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                        Active
                      </span>
                    </div>
                    <p className="mt-3 text-xs font-semibold text-slate-800">
                      {device.browser} on {device.operating_system} · {device.device_type}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-3 w-3" />
                        Opened {formatTime(device.started_at)}
                      </span>
                      <span>Last check-in {formatTime(device.last_seen_at)}</span>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-slate-500">
        Device details are coarse browser-reported categories. Offline or heavily backgrounded browsers may stop
        checking in and disappear from this active list.
      </p>
    </section>
  );
}
