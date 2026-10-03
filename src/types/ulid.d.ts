declare module "ulid" {
  export function ulid(seedTime?: number, prng?: ()=>number): string;
  export const ulid: (seedTime?: number, prng?: ()=>number)=>string;
  export const monotonicFactory: (prng?: ()=>number)=>(seedTime?: number)=>string;
  export function decodeTime(id: string): number;
  export function encodeTime(now: number, len?: number): string;
  export function isValid(id: string): boolean;
}
