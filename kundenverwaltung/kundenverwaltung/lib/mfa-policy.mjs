import {isIP,BlockList} from 'node:net';
const excluded=new BlockList();
for(const [ip,prefix]of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])excluded.addSubnet(ip,prefix,'ipv4');
for(const [ip,prefix]of [['2001:db8::',32],['2001::',32],['2001:2::',48],['2001:10::',28],['2001:20::',28],['2002::',16],['3fff::',20],['2001::',23]])excluded.addSubnet(ip,prefix,'ipv6');
export function approvedIP(value){const type=isIP(value);if(!type)throw new Error('Nur einzelne IP-Adressen ohne Netzmaske sind zulässig.');const ip=type===6?new URL('http://['+value+']/').hostname.slice(1,-1):value;if(type===4?excluded.check(ip,'ipv4'):!/^[23][0-9a-f]{3}:/.test(ip)||excluded.check(ip,'ipv6'))throw new Error('Nur öffentliche IPv4-/IPv6-Adressen freigeben.');return ip;}

export function normalizeIPs(values){if(!Array.isArray(values)||values.length>64)throw new Error('Maximal 64 einzelne öffentliche IP-Adressen eintragen.');return [...new Set(values.map(v=>{if(typeof v!=='string')throw new Error('Ungültige IP-Adresse.');return approvedIP(v.trim());}))].sort();}
export function allowlistConfig(values,upstream='172.30.93.3:8080'){
 const ips=normalizeIPs(values);if(!/^\d{1,3}(\.\d{1,3}){3}:[0-9]{1,5}$/.test(upstream))throw new Error('Ungültiges internes Proxyziel.');
 const proxy=policy=>'reverse_proxy '+upstream+' {\n header_up -Forwarded\n header_up X-Forwarded-For {remote_host}\n header_up X-Forwarded-Host {host}\n header_up X-Forwarded-Proto {scheme}\n header_up X-Kundenraum-OTP-Policy '+policy+'\n}\n';
 return '# Generated from administrator settings; exact socket IPs only.\n'+(ips.length?'@approvedOTP remote_ip '+ips.join(' ')+'\nhandle @approvedOTP {\n'+proxy('skip')+'}\n':'')+'handle {\n'+proxy('force')+'}\n';
}
