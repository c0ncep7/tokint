declare const run: (options: { data: { name: string; file: ArrayBuffer }[]; command: string[]; isStrict?: boolean }) => Promise<{ name: string; file: Uint8Array<ArrayBuffer> }[]>;
export default run;
