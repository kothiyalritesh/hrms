from PIL import Image
import collections

def scan(fname, regions):
    im = Image.open(fname).convert('RGB')
    w,h = im.size
    print(f'\n=== {fname} ({w}x{h}) ===')
    for label,(y1p,y2p,x1p,x2p) in regions.items():
        crop = im.crop((int(w*x1p),int(h*y1p),int(w*x2p),int(h*y2p)))
        pix = list(crop.getdata())
        c = collections.Counter((r//8*8,g//8*8,b//8*8) for r,g,b in pix)
        top = c.most_common(6)
        hexes = ['#%02x%02x%02x'%t for t,_ in top]
        print(f'  {label}: {hexes}')

scan('dashboard.jpeg',{
    'hero_bg':(0.04,0.38,0,1),
    'checkin_btn':(0.27,0.35,0.1,0.9),
    'stat_cards':(0.38,0.56,0,1),
    'quick_actions':(0.57,0.76,0,1),
    'task_cards':(0.76,0.88,0,1),
    'bottom_tab':(0.90,1.0,0,1),
})
scan('dashboard2.jpeg',{
    'top_bar':(0.02,0.10,0,1),
    'content_bg':(0.10,0.85,0,1),
    'cards_area':(0.12,0.50,0,1),
    'bottom_tab':(0.88,1.0,0,1),
})
scan('tvscreen.jpeg',{
    'outer_bg':(0,0.07,0,1),
    'top_header':(0.05,0.16,0,1),
    'col1_header':(0.16,0.28,0,0.33),
    'col1_cards':(0.28,0.70,0,0.33),
    'col2_header':(0.16,0.28,0.34,0.66),
    'col2_cards':(0.28,0.70,0.34,0.66),
    'col3_header':(0.16,0.28,0.67,1),
    'emp_row_bg':(0.35,0.50,0.02,0.30),
})
scan('report.jpeg',{
    'header':(0.02,0.10,0,1),
    'big_cards':(0.10,0.35,0,1),
    'chart_bg':(0.35,0.75,0,1),
    'bottom_tab':(0.88,1.0,0,1),
})
scan('reprt2.jpeg',{
    'header':(0.02,0.10,0,1),
    'metric_cards':(0.10,0.40,0,1),
    'list_section':(0.40,0.85,0,1),
    'bottom_tab':(0.88,1.0,0,1),
})
scan('1.png',{
    'icon_center':(0.2,0.8,0.2,0.8),
})
