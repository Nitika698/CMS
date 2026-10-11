import { AlertTriangle, Ban, Bell, BellRing, CheckCircle2, CircleDashed, XCircle } from 'lucide-react';

/**
 * How each post state looks. The four states the user must be able to tell apart are visually AND textually distinct:
 * a planned slot (dashed outline), a scheduled reminder (bell, blue), ready to publish (ringing bell, amber) and
 * published (solid green check). Colour is never the only signal: every chip carries an icon and the state's name.
 */
export const STAGE_STYLE = {
  planned: { icon: CircleDashed, chip: 'border border-dashed border-slate-400 bg-white text-slate-700', swatch: 'border border-dashed border-slate-500 bg-white' },
  scheduled: { icon: Bell, chip: 'border border-sky-300 bg-sky-50 text-sky-900', swatch: 'border border-sky-400 bg-sky-100' },
  awaiting_confirmation: { icon: BellRing, chip: 'border border-amber-400 bg-amber-50 text-amber-900', swatch: 'border border-amber-500 bg-amber-100' },
  published: { icon: CheckCircle2, chip: 'border border-emerald-700 bg-emerald-700 text-white', swatch: 'border border-emerald-700 bg-emerald-700' },
  missed: { icon: AlertTriangle, chip: 'border border-red-300 bg-red-50 text-red-800', swatch: 'border border-red-400 bg-red-100' },
  failed: { icon: XCircle, chip: 'border border-red-800 bg-red-700 text-white', swatch: 'border border-red-800 bg-red-700' },
  cancelled: { icon: Ban, chip: 'border border-slate-200 bg-slate-100 text-slate-500 line-through', swatch: 'border border-slate-300 bg-slate-100' },
};

/** Posts in these states can be moved to another time by dragging. */
export const MOVABLE = ['planned', 'scheduled', 'awaiting_confirmation', 'missed', 'failed'];
