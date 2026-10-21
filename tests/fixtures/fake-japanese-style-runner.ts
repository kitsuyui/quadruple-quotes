export {};

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk);
JSON.parse(Buffer.concat(chunks).toString());

const output = Buffer.from(
  JSON.stringify({
    ok: true,
    diagnostics: [
      {
        ruleId: "no-doubled-joshi",
        message: "分割😀を保持",
        range: { start: 0, end: 0 },
      },
    ],
  }),
);
const split = output.indexOf(Buffer.from("分")) + 1;
process.stdout.write(output.subarray(0, split));
await Bun.sleep(10);
process.stdout.write(output.subarray(split));
