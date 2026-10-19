/**
 * Who is allowed to provision.
 *
 * This plugin creates namespaces with a ServiceAccount that can create
 * namespaces. That is a much larger blast radius than anything else in this
 * repo, so who is calling is checked here rather than assumed from cluster
 * configuration elsewhere.
 *
 * In particular, guest sign-in is refused explicitly. Guest is an
 * installation-wide provider controlled by `auth.environment`, not a
 * per-plugin setting, so a future demo that turns it back on would otherwise
 * silently hand namespace creation to anyone who can load the page. Refusing
 * here means that change cannot reach this plugin by accident.
 *
 * A provisioning request also acts on behalf of exactly one user, and that
 * user is the caller. Taking the username from the request body would let
 * anyone create a namespace in someone else's name.
 */

export interface CallerIdentity {
  /** The Backstage entity ref, e.g. `user:default/andyrepton`. */
  userEntityRef: string;
  /** The bare username, which becomes the namespace prefix. */
  username: string;
}

export class NotAuthenticatedError extends Error {}
export class GuestNotAllowedError extends Error {}

/** Entity refs the guest provider issues. Matched case-insensitively. */
const GUEST_REFS = ['user:development/guest', 'user:default/guest'];

/**
 * Pull the username out of a Backstage entity ref.
 *
 * `user:default/andyrepton` -> `andyrepton`. The namespace part of the ref is
 * Backstage's own, not Kubernetes', and is dropped.
 */
export function usernameFromRef(ref: string): string {
  const afterKind = ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref;
  return afterKind.includes('/') ? afterKind.slice(afterKind.lastIndexOf('/') + 1) : afterKind;
}

export function assertProvisioner(ref: string | undefined): CallerIdentity {
  if (!ref) {
    throw new NotAuthenticatedError(
      'This request requires a signed-in user. Provisioning acts on behalf of one ' +
        'person and creates a namespace named after them.',
    );
  }

  if (GUEST_REFS.includes(ref.toLowerCase())) {
    throw new GuestNotAllowedError(
      'Guest sign-in cannot provision Dev Spaces. This endpoint creates a namespace ' +
        'and a resource quota using a privileged ServiceAccount, so it requires a real ' +
        'identity. Sign in with GitHub.',
    );
  }

  const username = usernameFromRef(ref);
  if (!username) {
    throw new NotAuthenticatedError(`Could not read a username from identity "${ref}".`);
  }

  return { userEntityRef: ref, username };
}
