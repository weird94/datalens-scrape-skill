/**
 * The two pieces of next/server the fixtures use, on top of the platform Request/Response, so the
 * playground runs without Next. Kept in sync by hand with what the fixtures touch: `nextUrl` and the
 * constructors.
 */
export class NextRequest extends Request {
  readonly nextUrl: URL

  constructor(input: string | URL | Request, init?: RequestInit) {
    super(input, init)
    this.nextUrl = new URL(this.url)
  }
}

export class NextResponse extends Response {}
