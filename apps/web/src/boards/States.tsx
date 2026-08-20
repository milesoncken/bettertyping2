/**
 * The three things a screen can be other than full of data.
 *
 * A board that renders empty when the request failed is a lie about the world,
 * so failure says so in as many words. Emptiness is a designed state too: every
 * board starts empty, and "be first" is better copy than a blank table.
 */

export function Loading(): React.JSX.Element {
  return <p className="empty label">loading</p>;
}

export function Failed({ what }: { what: string }): React.JSX.Element {
  return (
    <p className="empty label" data-tone="bad">
      could not reach the server — this is not an empty {what}, it is an unanswered one
    </p>
  );
}

export function Empty({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="empty label">{children}</p>;
}
