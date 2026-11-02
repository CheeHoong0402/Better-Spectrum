"""Generate the app's simple calendar/checkmark icons using only Python's standard library."""
import struct, zlib
from pathlib import Path

def make(size):
    bg, ink = (23,45,40,255), (232,241,207,255)
    pixels = bytearray(bg * (size*size))
    def line(x1,y1,x2,y2,width):
        x1,y1,x2,y2=[v*size/512 for v in (x1,y1,x2,y2)]
        radius=width*size/1024
        for y in range(max(0,int(min(y1,y2)-radius)),min(size,int(max(y1,y2)+radius)+1)):
            for x in range(max(0,int(min(x1,x2)-radius)),min(size,int(max(x1,x2)+radius)+1)):
                dx,dy=x2-x1,y2-y1
                t=max(0,min(1,((x-x1)*dx+(y-y1)*dy)/(dx*dx+dy*dy or 1)))
                if (x-x1-t*dx)**2+(y-y1-t*dy)**2<=radius**2:
                    i=(y*size+x)*4; pixels[i:i+4]=bytes(ink)
    for p in [(115,180,397,180),(397,180,397,380),(397,380,115,380),(115,380,115,180),(115,240,397,240),(185,150,185,210),(327,150,327,210),(172,298,224,346),(224,346,316,252)]:line(*p,18)
    def chunk(kind,data):return struct.pack('!I',len(data))+kind+data+struct.pack('!I',zlib.crc32(kind+data)&0xffffffff)
    raw=b''.join(b'\0'+pixels[y*size*4:(y+1)*size*4] for y in range(size))
    Path(f'public/icon-{size}.png').write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b''))
for size in (192,512):make(size)
