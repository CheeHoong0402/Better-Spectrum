import {writeFile,access} from 'node:fs/promises';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
try{await access('.dev.vars');console.log('Local configuration already exists.');}catch{
 const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});const pub=publicKey.export({format:'jwk'}),priv=privateKey.export({format:'jwk'});
 const key=Buffer.concat([Buffer.from([4]),Buffer.from(pub.x,'base64url'),Buffer.from(pub.y,'base64url')]).toString('base64url');
 await writeFile('.dev.vars',`APP_PASSWORD="local-preview-only"\nAUTH_SECRET="${randomBytes(32).toString('base64url')}"\nVAPID_PUBLIC_KEY="${key}"\nVAPID_PRIVATE_KEY="${priv.d}"\nVAPID_SUBJECT="https://spectrum.um.edu.my/"\n`,{mode:0o600});console.log('Local preview configured. Passphrase: local-preview-only. Production must use a separate private passphrase.');
}
