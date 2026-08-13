from PIL import Image, ImageDraw
import collections, os

def px(fname, y1p,y2p,x1p,x2p, label=''):
    im = Image.open(fname).convert('RGB')
    w,h = im.size
    x1,y1,x2,y2 = int(w*x1p),int(h*y1p),int(w*x2p),int(h*y2p)
    crop = im.crop((x1,y1,x2,y2))
    pix = list(crop.getdata())
    c = collections.Counter((r//4*4,g//4*4,b//4*4) for r,g,b in pix)
    top = c.most_common(10)
    hexes = ['#%02x%02x%02x'%t for t,_ in top]
    print(f'{label}: {hexes[:6]}')

print('\n=== dashboard.jpeg ===')
px('dashboard.jpeg',0.04,0.12,0,1,'statusbar')
px('dashboard.jpeg',0.12,0.38,0,1,'hero_full')
px('dashboard.jpeg',0.28,0.35,0.12,0.88,'checkin_btn')
px('dashboard.jpeg',0.38,0.49,0.02,0.49,'card_TL')
px('dashboard.jpeg',0.38,0.49,0.51,0.98,'card_TR')
px('dashboard.jpeg',0.50,0.57,0.02,0.49,'card_BL')
px('dashboard.jpeg',0.50,0.57,0.51,0.98,'card_BR')
px('dashboard.jpeg',0.57,0.61,0,1,'section_hdr')
px('dashboard.jpeg',0.61,0.77,0.02,0.98,'quick_actions_area')
px('dashboard.jpeg',0.77,0.88,0,1,'task_list')
px('dashboard.jpeg',0.88,0.96,0,1,'tab_bar')

print('\n=== dashboard2.jpeg ===')
px('dashboard2.jpeg',0.03,0.11,0,1,'header')
px('dashboard2.jpeg',0.11,0.13,0,1,'page_title_area')
px('dashboard2.jpeg',0.13,0.35,0,0.48,'col_left')
px('dashboard2.jpeg',0.13,0.35,0.52,1,'col_right')
px('dashboard2.jpeg',0.35,0.55,0,1,'mid_section')
px('dashboard2.jpeg',0.55,0.75,0,1,'lower_section')
px('dashboard2.jpeg',0.87,0.96,0,1,'tab_bar')

print('\n=== tvscreen.jpeg ===')
px('tvscreen.jpeg',0,0.05,0,1,'tv_bg')
px('tvscreen.jpeg',0.05,0.17,0,1,'tv_topbar')
px('tvscreen.jpeg',0.17,0.28,0,0.32,'col1_hdr')
px('tvscreen.jpeg',0.28,0.34,0.01,0.31,'team1_hdr')
px('tvscreen.jpeg',0.34,0.55,0.01,0.31,'emp_rows')
px('tvscreen.jpeg',0.17,0.28,0.34,0.65,'col2_hdr')
px('tvscreen.jpeg',0.17,0.28,0.68,1,'col3_hdr')
px('tvscreen.jpeg',0.28,0.34,0.34,0.65,'team2_hdr')
px('tvscreen.jpeg',0.34,0.55,0.34,0.65,'emp_rows2')

print('\n=== report.jpeg ===')
px('report.jpeg',0.03,0.11,0,1,'header')
px('report.jpeg',0.11,0.38,0,0.48,'big_card_left')
px('report.jpeg',0.11,0.38,0.52,1,'big_card_right')
px('report.jpeg',0.38,0.65,0,1,'chart_section')
px('report.jpeg',0.65,0.88,0,1,'list_section')

print('\n=== reprt2.jpeg ===')
px('reprt2.jpeg',0.03,0.11,0,1,'header')
px('reprt2.jpeg',0.11,0.35,0,0.48,'card_L')
px('reprt2.jpeg',0.11,0.35,0.52,1,'card_R')
px('reprt2.jpeg',0.35,0.65,0,1,'list_area')
