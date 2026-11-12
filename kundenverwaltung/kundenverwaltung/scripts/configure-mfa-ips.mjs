import {isIP,BlockList} from 'node:net';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const excluded=new BlockList();
for(const [ip,prefix]of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])excluded.addSubnet(ip,prefix,'ipv4');
for(const [ip,prefix]of [['2001:db8::',32],['2001::',32],['2001:2::',48],['2001:10::',28],['2001:20::',28],['2002::',16],['3fff::',20],['2001::',23]])excluded.addSubnet(ip,prefix,'ipv6');
export function approvedIP(value){const type=isIP(value);if(!type)throw new Error('Nur einzelne IP-Adressen ohne Netzmaske sind zulässig.');const ip=type===6?new URL('http://['+value+']/').hostname.slice(1,-1):value;if(type===4?excluded.check(ip,'ipv4'):!/^[23][0-9a-f]{3}:/.test(ip)||excluded.check(ip,'ipv6'))throw new Error('Nur öffentliche IPv4-/IPv6-Adressen freigeben.');return ip;}
export function allowlistConfig(values){const ips=[...new Set(values.map(approvedIP))];return ips.length?'@approvedOTP remote_ip '+ips.join(' ')+'\nvars @approvedOTP otp_policy skip\n':'# Empty allowlist: OTP required except cashier role.\n';}
if(process.argv[1]===fileURLToPath(import.meta.url)){const values=process.argv.slice(2);writeFileSync(new URL('../deploy/mfa-allowlist.caddy',import.meta.url),allowlistConfig(values));console.log('IP-Freigabeliste gespeichert ('+values.length+'). Caddy-Konfiguration prüfen und neu laden.');}
