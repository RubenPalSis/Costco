import { generateKeyPairSync } from "node:crypto";

const { privateKey: key } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
const { x, y, d } = key.export({ format: "jwk" });
const publicKey = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(x, "base64url"),
  Buffer.from(y, "base64url"),
]);
process.stdout.write(
  "VAPID_PUBLIC_KEY=" +
    publicKey.toString("base64url") +
    "\nVAPID_PRIVATE_KEY=" +
    d +
    "\n",
);
