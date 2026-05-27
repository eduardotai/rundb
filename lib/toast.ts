import { toast } from 'sonner';

export { toast };

/**
 * User-facing error toast — always a bold red "pop box".
 * 
 * Rules:
 * - Message must be short and friendly (< 2 lines total)
 * - No technical jargon, raw error codes, or stack traces
 * - Prefer this over raw toast.error() for anything the end-user sees.
 */
export function showUserError(message: string) {
  toast.error(message, {
    duration: 5200,
    closeButton: true,
  });
}

/**
 * User-facing success toast helper.
 */
export function showUserSuccess(message: string, description?: string) {
  if (description) {
    toast.success(message, { description, duration: 4200 });
  } else {
    toast.success(message, { duration: 3200 });
  }
}
