declare module "ulid" {
  export function ulid(seedTime?: number, prng?: () => number): string;
}
