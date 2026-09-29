import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AuthUser } from '@libraverse/shared';
import { Button, ErrorText } from '../../components/ui';
import { errorMessage, put } from '../../lib/api';
import { ME_KEY, useMe } from '../auth/useAuth';

/** Staff can require an emailed code at sign-in (two-factor). */
export function SecurityPage() {
  const { data: user } = useMe();
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => put<{ user: AuthUser }>('/api/auth/two-factor', { enabled }),
    onSuccess: (res) => qc.setQueryData(ME_KEY, res.user),
  });
  if (!user) return null;

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold">Security</h1>
      <section className="mt-6 rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h2 className="font-medium">Two-factor sign-in</h2>
        <p className="mt-1 text-sm text-gray-400">
          {user.twoFactorEnabled
            ? `On. Each sign-in asks for a code emailed to ${user.email}.`
            : 'Off. Turn it on to require a code emailed to you at each sign-in.'}
        </p>
        <div className="mt-4">
          <ErrorText>{toggle.error ? errorMessage(toggle.error) : ''}</ErrorText>
        </div>
        <Button
          className="mt-3"
          variant={user.twoFactorEnabled ? 'secondary' : 'primary'}
          busy={toggle.isPending}
          onClick={() => toggle.mutate(!user.twoFactorEnabled)}
        >
          {user.twoFactorEnabled ? 'Turn off' : 'Turn on'}
        </Button>
      </section>
    </div>
  );
}
