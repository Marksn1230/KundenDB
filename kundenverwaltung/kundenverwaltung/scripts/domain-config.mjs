export function domainSettings(values){
 const domain=String(values.APP_DOMAIN||'').trim().toLowerCase();
 if(domain.length>253||!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))throw new Error('Hostname ohne Schema, Port oder Pfad eingeben, zum Beispiel kunden.example.at.');
 const flag=String(values.HTTPS_ENABLED??'true');if(!['true','false'].includes(flag))throw new Error('HTTPS_ENABLED muss true oder false sein.');
 const https=flag==='true',email=String(values.ACME_EMAIL||values.TLS_EMAIL||'').trim(),environment=values.ACME_ENV||'production';
 if(https&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254))throw new Error('Für HTTPS eine gültige ACME-Kontaktadresse eingeben.');
 if(!['production','staging'].includes(environment))throw new Error('ACME_ENV muss production oder staging sein.');
 return {domain,https,email,environment,origin:(https?'https://':'http://')+domain,directory:environment==='staging'?'https://acme-staging-v02.api.letsencrypt.org/directory':'https://acme-v02.api.letsencrypt.org/directory'};
}
