"""Turn the Fullbay 'ALL CUSTOMERS ALL DRILLS' export into the app's spine.

Two corrections are applied on the way through, both from Mike:
  - Aggregate Crusher Specialist is not a customer; its DR635 record is a
    duplicate of the 3 Rivers machine of the same serial.
  - Western Explosives Company goes by WESCO; AZDB is a DBA of Fisher.
Nothing else is cleaned. A blank serial stays blank, because a machine with
no serial on file is a real condition the app has to show rather than hide.
"""
import json, re, csv, io, os

ROWS = """\
US Calcium Company\t1\t\t110T15405-1\t2010 SANDVIK RANGER 800\t0
Top Rock Blasting\t1\t\t581033\tFURUKAWA HCR9-ES\t2709
Wilkinson Construction Co.\t1\t\t65690\t2021 Sandvik DI650\t2244
Fisher Industries\t110221\t\t9456\t\t9006
Fisher Industries\t110237\t\t26236\tSANDVIK RANGER 800\t8635
Fisher Industries\t110245\t\t39376\t\t8815
Fisher Industries\t110256\t\tTMG16SED0207\t2016 ATLAS COPCO T45 DRIFTER 3060MEX\t7717
Fisher Industries\t11028\t\t61450\t\t4276
Fisher Industries\t110292\t\t54459\tSANDVIK DI550\t6913
Fisher Industries\t110299\t\t56322\t2020 SANDVIK RANGER 800\t4994
Fisher Industries\t110346\t\t60374\t2020 SANDVIK RANGER 800\t4327
Fisher Industries\t110352\t\tTMG19SED0037/8992 0117 38\t2019 SMARTROC T40-11\t6243
Fisher Industries\t110358\t\t\tSandvik DI550\t5048
Fisher Industries\t110371\t\t77186\t2021 SANDVIK RANGER DX800\t9456
Fisher Industries\t110372\t\t68792\t2021 SANDVIK RANGER 800\t6722
Fisher Industries\t110374\t\t60674\tSANDVIK DI550\t2613
Fisher Industries\t110381\t\t80906\t2022 SANDVIK DI550\t4257
Fisher Industries\t110390\t\tTMG23SED0197\t2023 EPIROC D65\t0
Fisher Industries\t110401\t\t\t\t1281
Fisher Industries\t110409\t\t\t\t
Fisher Industries\t110420\t\t82583\t2022 SANDVIK RANGER 900\t0
Wilkinson Construction Co.\t2\t\t82517\t2022 Sandvik DI650\t1137
Kiewit Mining Group Inc.\t2.02E+11\t\t2.02E+11\tMD6290\t26657
Fisher Industries\t211469\t\tTMG25SED0086\t2025 EPIROC D65\t1438
WESCO - NV\t27908\t\t\t\t12566
Ames Construction Inc\t3393002\t\t3705\t1992 INGERSOLL RAND DM45\t2103
WESCO - UT\t34965\t\t34965\tSANDVIK DI550\t11529
BLACK BUTTE COAL COMPANY\t4342\t\t4342\tATLAS COPCO DMM3\t
WESCO - UT\t49998\t\t49998\t2019 SANDVIK LEOPARD DI550\t10644
WESCO - UT\t54471\t\t54471\t\t6848
WESCO - NV\t56407\t\t56407\t2019 SANDVIK PANTERA 1500\t9720
WESCO - UT\t60716\t\t60716\t2022 SANDVIK PANTERA 1500\t5724
WESCO - UT\t70165\t\t70165\t2022 EPIROC DM45\t4774
Fisher Industries\t75772\t\t75772\tSANDVIK DI550\t5002
WESCO - UT\t775772\t\t\t\t2696
WESCO - UT\t82534\t\t82534\t2022 SANDVIK DI550\t3469
Kiewit Mining Group Inc.\t837\t\t3665\t1992 Ingersoll Rand DMM2\t1068
WESCO - UT\t84235\t\t84235\t\t1823
WESCO - NV\t8619\t\t8619\t2014 Atlas Copco DM45\t9214
Fisher Industries\t87650\t\t87650\t\t2995
Simplot Smokey Canyon\t8982\t\t8982\tEpiroc DML\t
Sandex Blasting\t8998\t\t8998\tATLAS COPCO DM45\t6558
WESCO - UT\t9336\t\t9336\t\t
Fisher Industries\t94266\t\t94266\t2024 SANDVIK DI550\t1182
Fisher Industries\t9453\t\t9453\t\t7196
Fisher Industries\t9627\t\t9627\tATLAS COPCO DM45 HP\t2424
Cate Equipment\tAVO 11V1011\t\tAVO 11v1011/8992 6000 20\t\t2165
ARI Inc.\tD-43\t\tTMG20SED0008\t2020 Epiroc D65 SmartRoc\t7728
ARI Inc.\tD-44\t\tTMG19SED0213\t2019 Epiroc D65 SmartRoc\t
Kiewit Mining Group Inc.\tD65\t\t\t\t5359
Rocking P Blasting\tDR07\t\t\tSandvik DPI1500\t8570
Rocking P Blasting\tDR08\t\t\t\t8623
Rocking P Blasting\tDR13\t\t\tSANDVIK DI550\t7229
Rocking P Blasting\tDR19\t\t98132\t2024 SANDVIK DI550\t805
3 Rivers Drilling & Blasting\tDR607\tFred\t7165\t1996 Ingersoll Rand DM45\t3157
3 Rivers Drilling & Blasting\tDR614\t\t44834\t2017 Sandvik Ranger DX800\t
3 Rivers Drilling & Blasting\tDR615\t\tTMG165SED0263\t2016 Atlas Copco T45 Smartroc\t8966
3 Rivers Drilling & Blasting\tDR616\t\t\t\t7202
3 Rivers Drilling & Blasting\tDR617\t\t47047\t2017 Sandvik Ranger DX800\t8963
3 Rivers Drilling & Blasting\tDR618\t\t43355\t2016 Sandvik Ranger DX800\t
3 Rivers Drilling & Blasting\tDR619\t\t1726312\t2017 Jun Jin 1400E-II\t
3 Rivers Drilling & Blasting\tDR620\t\t1400-118\t2019 Jun Jin 1400E-II\t5876
3 Rivers Drilling & Blasting\tDR621\t\t800-118\t2019 Jun Jin 800E-II\t
3 Rivers Drilling & Blasting\tDR622\tWilma\t7825\t2004 Ingersoll Rand DM45\t2876
3 Rivers Drilling & Blasting\tDR623\t\t58348\t2019 Sandvik Leopard 550\t7200
3 Rivers Drilling & Blasting\tDR624\tBarney\t7194\t1996 Ingersoll Rand DM45\t8322
3 Rivers Drilling & Blasting\tDR625\tPebbles\t2830\t1989 Ingersoll Rand DM45\t6388
3 Rivers Drilling & Blasting\tDR626\t\t127\t2020 Jun Jin 1400E-II\t
3 Rivers Drilling & Blasting\tDR627\t\t1940704\t2019 Jun Jin JD-800-II\t
3 Rivers Drilling & Blasting\tDR629\t\t\t\t2169
3 Rivers Drilling & Blasting\tDR630\t\t\t2023 SOOSAN 1400E\t3704
3 Rivers Drilling & Blasting\tDR631\t\t156\t2022 SOOSAN JD-800EII\t2059
3 Rivers Drilling & Blasting\tDR632\t\t84646\t2024 SANDVIK PANTERA 1500\t2877
3 Rivers Drilling & Blasting\tDR633\t\t\t\t1114
3 Rivers Drilling & Blasting\tDR635\t\t84733\t2025 SANDVIK DPI650\t2407
3 Rivers Drilling & Blasting\tDR638\t\t111320\t2026 SANDVIK Ranger 800\t320
Top Rock Blasting\tRANGER 700\t\t\t\t
"""

MAKES = ['EPIROC', 'ATLAS COPCO', 'SANDVIK', 'INGERSOLL RAND', 'FURUKAWA',
         'JUN JIN', 'SOOSAN', 'CATERPILLAR']


def split_model(s):
    """'2022 EPIROC DM45' -> (2022, 'Epiroc', 'DM45'). Unknown stays unknown."""
    s = (s or '').strip()
    if not s:
        return None, '', ''
    m = re.match(r'^(19|20)\d{2}\b', s)
    year = int(m.group(0)) if m else None
    rest = s[m.end():].strip() if m else s
    up = rest.upper()
    for mk in MAKES:
        if up.startswith(mk):
            return year, rest[:len(mk)].title() if mk != 'ATLAS COPCO' else 'Atlas Copco', \
                   rest[len(mk):].strip()
    return year, '', rest


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    equip, customers = [], {}
    for line in io.StringIO(ROWS):
        if not line.strip():
            continue
        cust, unit, nick, serial, model, meter = (line.rstrip('\n').split('\t') + [''] * 6)[:6]
        year, make, mdl = split_model(model)
        cid = re.sub(r'[^a-z0-9]+', '-', cust.lower()).strip('-')
        customers.setdefault(cid, {'id': cid, 'name': cust, 'machines': 0})
        customers[cid]['machines'] += 1
        equip.append({
            'id': f"{cid}--{re.sub(r'[^A-Za-z0-9]+', '', unit) or 'x'}",
            'customer': cid, 'customerName': cust,
            'unit': unit, 'nickname': nick,
            'serial': serial, 'model': model,
            'year': year, 'make': make, 'modelOnly': mdl,
            'meter': int(meter) if meter.isdigit() else None,
        })

    # --- gates -------------------------------------------------------
    bad = []
    ids = [e['id'] for e in equip]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        bad.append(f'duplicate machine ids: {sorted(dup)}')
    if any(e['customerName'].startswith('Aggregate Crusher') for e in equip):
        bad.append('Aggregate Crusher Specialist is not a customer and should not be here')
    if any('Western Explosives' in e['customerName'] for e in equip):
        bad.append('Western Explosives should read WESCO')
    noserial = [e['unit'] for e in equip if not e['serial']]

    out = sorted(customers.values(), key=lambda c: c['name'].lower())
    json.dump(equip, open(os.path.join(here, 'equipment.json'), 'w'), indent=1)
    json.dump(out, open(os.path.join(here, 'customers.json'), 'w'), indent=1)

    print(f'customers : {len(out)}')
    print(f'machines  : {len(equip)}')
    print(f'no serial : {len(noserial)} ({", ".join(noserial[:8])}...)')
    print(f'no model  : {sum(1 for e in equip if not e["model"])}')
    print('problems  :', len(bad))
    for b in bad:
        print('   ', b)


if __name__ == '__main__':
    main()
