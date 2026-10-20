#!/usr/bin/env python3
"""Lift the Pre-Op checklist off the live app, verbatim, into a versioned template.

Read in full before changing anything here.

The point of this file is that it is a COPY, not a rewrite. Every item string
below was pulled out of https://bsds-app.github.io/preop/ on 20 Oct 2026 by
parsing the CHECKLISTS literal in the page and reading the strings back. The
techs already know this form; a reworded item is a different form.

Counts are asserted at the bottom against the counts read off the live object
BEFORE the strings were transcribed. If a transcription dropped a line, the
assert fails - that is the whole safety net. Silence must not look like
success.

v1 == the form as it stood on 20 Oct 2026. When the checklist changes, add
v2 and leave v1 alone: a record filed in 2026 has to render with the 2026
checklist a year later, not with rows that did not exist when it was signed.
"""
import json, pathlib

# counts read off the live CHECKLISTS object before transcribing (the gate)
LIVE_COUNTS = {
    'rig':            {'Fluids & Engine': 6, 'Structure & Mast': 6, 'Drilling System': 4,
                       'Safety & Controls': 10},
    'truck':          {'Fluids & Engine': 6, 'Brakes & Air System (DOT)': 7,
                       'Tires, Wheels & Suspension': 4, 'Lights & Visibility': 5,
                       'Safety & DOT Equipment': 11},
    'pickup':         {'Fluids & Engine': 5, 'Tires & Brakes': 5, 'Lights & Visibility': 4,
                       'Safety & Cab': 6},
    'forklift':       {'Fluids & Power Source': 6, 'Mast & Forks': 5, 'Tires & Steering': 3,
                       'Safety & Controls': 8},
    'supportequip':   {'Fluids & Engine': 5, 'Undercarriage, Tires & Tracks': 3,
                       'Hydraulics & Attachments': 5, 'Safety & Controls': 8},
    'crane':          {'Structure & Boom': 5, 'Hydraulics & Controls': 6,
                       'Outriggers & Stability': 3,
                       'Rigging — Slings & Lifting Devices': 8, 'Safety & Controls': 5},
}
LIVE_COUNTS_FP = {
    'daily':  {'Harness': 5, 'Connecting Device (Lanyard / SRL)': 5, 'Anchor Point': 2,
               'General': 3},
    'annual': {'Harness — Detailed Inspection': 4,
               'Connecting Device — Detailed Inspection': 5, 'Anchor Point': 2,
               'Documentation & Compliance': 4},
}

TYPES = {}

TYPES['rig'] = {
    'label': 'Blasthole Drill Rig',
    'meterLabel': 'Hour Meter',
    'sections': {
        'Fluids & Engine': [
            'Engine oil level',
            'Coolant level',
            'Hydraulic oil level / visible leaks',
            'Fuel level adequate',
            'Air compressor oil level',
            'Fuel/water separator drained',
        ],
        'Structure & Mast': [
            'Mast / tower condition (welds, pins, cracks)',
            'Wire ropes / cables condition',
            'Mast raise/lower function',
            'Leveling jacks / outriggers',
            'Undercarriage / tracks or tires condition',
            'Pipe rack & carousel condition',
        ],
        'Drilling System': [
            'Rotary head / gearbox condition',
            'Dust collector / dust suppression system',
            'Air/water lines and fittings',
            'Deck bushings and rod handling tools',
        ],
        'Safety & Controls': [
            'Fire extinguisher present & charged',
            'Back-up alarm functioning',
            'Horn functioning',
            'All lights functioning',
            'Emergency stop(s) functioning',
            'Guards & shields in place',
            'Gauges / control panel functioning',
            'Seat belt condition',
            'Cab windows / visibility clear',
            'Housekeeping (deck clear of debris/tools)',
        ],
    },
}

TYPES['truck'] = {
    'label': 'Service Truck',
    'meterLabel': 'Odometer',
    'sections': {
        'Fluids & Engine': [
            'Engine oil level',
            'Coolant level',
            'Visible fluid leaks',
            'Fuel level adequate',
            'Washer fluid level',
            'Belts & hoses condition',
        ],
        'Brakes & Air System (DOT)': [
            'Service brake function',
            'Parking brake (spring brake) function',
            'Air system builds to governor cut-out pressure',
            'Low air pressure warning activates correctly',
            'Air loss rate within limits (engine off, brakes applied)',
            'Air lines / hoses — no leaks, chafing, or cracking',
            'Brake linings / pads / drums — visible wear check',
        ],
        'Tires, Wheels & Suspension': [
            'Tire tread depth & pressure (all tires)',
            'Wheel rims / lug nuts — no cracks, all present & tight',
            'Suspension — springs, U-bolts, mounts',
            'Frame condition — no cracks or damage',
        ],
        'Lights & Visibility': [
            'Headlights',
            'Tail / brake / turn signal / hazard lights',
            'Reflectors & marker lights',
            'Mirrors adjusted & intact',
            'Windshield condition / wipers & washer',
        ],
        'Safety & DOT Equipment': [
            'Horn functioning',
            'Back-up alarm functioning',
            'Seat belts condition',
            'Steering — no excessive play',
            'Exhaust system — no leaks, properly secured',
            'Coupling devices secure & pinned (if towing)',
            'Fire extinguisher present & charged (DOT-rated)',
            'Emergency triangles / flares present (3 required)',
            'Spare fuses / circuit breakers accessible (if equipped)',
            'Load secured / tie-downs (if hauling)',
            'Cab housekeeping / clear of loose items',
        ],
    },
}

TYPES['pickup'] = {
    'label': 'Pickup Truck',
    'meterLabel': 'Odometer',
    'sections': {
        'Fluids & Engine': [
            'Engine oil level',
            'Coolant level',
            'Visible fluid leaks',
            'Fuel level adequate',
            'Washer fluid level',
        ],
        'Tires & Brakes': [
            'Tire tread depth & pressure (all tires, incl. spare)',
            'Wheel lug nuts secure, no cracks',
            'Brake function / pedal feel',
            'Parking brake function',
            'Spare tire & jack present',
        ],
        'Lights & Visibility': [
            'Headlights',
            'Tail / brake / turn signal / hazard lights',
            'Mirrors adjusted & intact',
            'Windshield condition / wipers & washer',
        ],
        'Safety & Cab': [
            'Horn functioning',
            'Seat belts condition',
            'Fire extinguisher present (if equipped)',
            'First aid kit present',
            'Load secured / tie-downs (if hauling)',
            'Cab / bed housekeeping — clear of loose items',
        ],
    },
}

TYPES['forklift'] = {
    'label': 'Forklift',
    'meterLabel': 'Hour Meter',
    'sections': {
        'Fluids & Power Source': [
            'Engine oil level (IC models)',
            'Coolant level (IC models)',
            'Hydraulic fluid level / visible leaks',
            'Fuel/LP tank secure & leak-free (IC models)',
            'Battery water level & charge (electric models)',
            'Battery cables/connections secure, no corrosion (electric models)',
        ],
        'Mast & Forks': [
            'Forks condition — no cracks, bends, excessive wear',
            'Fork positioning locks functioning',
            'Mast chains/cables condition, properly lubricated',
            'Mast tilt function smooth, no excessive drift',
            'Carriage / load backrest secure',
        ],
        'Tires & Steering': [
            'Tire condition (cuts, wear, proper inflation if pneumatic)',
            'Steering function — no excessive play',
            'Brakes function (service & parking)',
        ],
        'Safety & Controls': [
            'Horn functioning',
            'Back-up alarm functioning',
            'Seat belt condition & functioning',
            'Overhead guard condition, no damage',
            'All lights/strobe functioning',
            'Hydraulic controls smooth, no drift',
            'Data plate / capacity plate legible',
            'Fire extinguisher present & charged (if equipped)',
        ],
    },
}

TYPES['supportequip'] = {
    'label': 'Support Equipment (Skid Steer / Compact Loader)',
    'meterLabel': 'Hour Meter',
    'sections': {
        'Fluids & Engine': [
            'Engine oil level',
            'Coolant level',
            'Hydraulic fluid level / visible leaks',
            'Fuel level adequate',
            'Air filter / intake clear',
        ],
        'Undercarriage, Tires & Tracks': [
            'Tires or tracks condition & wear',
            'Lug nuts / track tension correct',
            'Undercarriage free of debris buildup',
        ],
        'Hydraulics & Attachments': [
            'Attachment properly locked/pinned to quick-attach',
            'Bucket/attachment condition — no cracks or excessive wear',
            'Hydraulic quick-connects — no leaks, properly seated',
            'Auxiliary hydraulics function correctly',
            'Lift arms — pins, bushings, cylinders condition',
        ],
        'Safety & Controls': [
            'Seat belt condition & functioning',
            'ROPS/FOPS structure intact, no damage',
            'Seat bar / door interlock functioning',
            'Back-up alarm functioning',
            'Horn functioning',
            'All lights functioning',
            'Parking brake function',
            'Gauges / control panel functioning',
        ],
    },
}

TYPES['crane'] = {
    'label': 'Crane',
    'meterLabel': 'Hour Meter',
    'sections': {
        'Structure & Boom': [
            'Boom sections condition (dents, cracks, bends)',
            'Boom angle indicator functioning',
            'Wire rope / hoist cable condition (fraying, kinks, birdcaging)',
            'Sheaves & pulleys condition, properly seated',
            'Load chart present & legible in cab',
        ],
        'Hydraulics & Controls': [
            'Crane hydraulic system — leaks / hose condition',
            'Swing / rotation function smooth',
            'PTO engagement functioning',
            'Remote control functioning (if equipped)',
            'Load moment indicator / rated capacity indicator functioning',
            'Anti-two-block device functioning',
        ],
        'Outriggers & Stability': [
            'Outriggers / stabilizers fully extend & lock',
            'Outrigger pads / cribbing on board',
            'Level indicator / bubble level functioning',
        ],
        'Rigging — Slings & Lifting Devices': [
            'Wire rope slings — no broken wires, kinks, corrosion',
            'Synthetic/web slings — no cuts, burns, UV damage, stitching intact',
            'Chain slings — no stretched links, cracks, or gouges',
            'Shackles — correct pin, no deformation, load rated',
            'Hooks — safety latches functioning, no cracks or throat deformation',
            'Rigging hardware load rating tags/labels legible',
            'Spreader / lifting beams condition (if used)',
            'Tag lines on board',
        ],
        'Safety & Controls': [
            'Crane emergency stop functioning',
            'Swing warning horn/alarm functioning',
            'Fire extinguisher present & charged',
            'Annual crane inspection decal / certification current',
            'Operator qualification/certification on file',
        ],
    },
}

# Fall protection is the odd one out in the live app too: no meter, and the
# checklist depends on the frequency rather than the machine.
FALLPROTECTION = {
    'label': 'Fall Protection Equipment',
    'meterLabel': 'Serial / Asset #',
    'byFrequency': {
        'daily': {
            'Harness': [
                'Webbing — no cuts, frays, burns, chemical damage',
                'Stitching intact, no pulled/broken threads',
                'D-rings — no cracks, distortion, excessive wear',
                'Buckles / friction buckles function properly',
                'Labels/tags legible (capacity, manufacture date)',
            ],
            'Connecting Device (Lanyard / SRL)': [
                'Shock-absorbing pack intact, not deployed/torn',
                'Snap hooks / carabiners — gate closes & locks properly',
                'No visible fraying, kinks, or corrosion on lanyard/cable',
                'SRL — cable/webbing spools smoothly, locks when jerked',
                'Rated capacity label legible',
            ],
            'Anchor Point': [
                'Anchor point rated for fall arrest (5,000 lb or per engineer)',
                'Anchor connection hardware inspected, secure',
            ],
            'General': [
                'No signs of prior fall arrest (deployed indicator)',
                'Equipment free of unauthorized modifications',
                'Removed from service if any defect found',
            ],
        },
        'annual': {
            'Harness — Detailed Inspection': [
                'Full webbing inspected end-to-end (cuts, abrasion, UV/chemical/heat damage)',
                'All stitching inspected (no broken/pulled threads)',
                'D-rings, buckles, hardware — cracks, corrosion, excessive wear',
                'Labels/tags legible (capacity, manufacture date, model)',
            ],
            'Connecting Device — Detailed Inspection': [
                'Shock-absorbing pack intact, not deployed/torn',
                'Snap hooks / carabiners — gate, lock, and load bearing components inspected',
                'Lanyard/cable/webbing inspected full length',
                'SRL housing, cable, and locking mechanism inspected/serviced per manufacturer',
                'Rated capacity label legible',
            ],
            'Anchor Point': [
                'Anchor point rated for fall arrest (5,000 lb or per engineer)',
                'Anchor connection hardware inspected, secure',
            ],
            'Documentation & Compliance': [
                'Inspection tag/log updated with date & inspector name',
                'Equipment manufacture date checked vs. manufacturer service-life limit',
                'Certification/inspection record filed for compliance',
                'Equipment tagged "DO NOT USE" and removed from service if any deficiency found',
            ],
        },
    },
}

TEMPLATE = {
    'form': 'preop',
    'version': 1,
    'effective': '2026-10-20',
    'liftedFrom': 'https://bsds-app.github.io/preop/',
    'note': ('Verbatim copy of the Pre-Op Inspection App checklist as it stood on '
             '20 Oct 2026. Records store this version number so they render with '
             'the form they were actually filled on.'),
    # the three buttons on every line, exactly as the live app writes them
    'resultChoices': [
        {'value': 'pass', 'label': 'Pass'},
        {'value': 'fail', 'label': 'Fail'},
        {'value': 'na',   'label': 'N/A'},
    ],
    'frequencies': [
        {'value': 'daily',  'label': 'Daily / Pre-Use'},
        {'value': 'annual', 'label': 'Annual / Periodic (Competent Person)'},
    ],
    # the fields above and below the checklist, in the order the live form asks
    'header': [
        {'key': 'eqType',        'label': 'Equipment Type',      'kind': 'type'},
        {'key': 'inspFrequency', 'label': 'Inspection Frequency','kind': 'frequency'},
        {'key': 'eqUnit',        'label': 'Unit',                'kind': 'unit'},
        {'key': 'operatorName',  'label': 'Operator Name',       'kind': 'text'},
        {'key': 'inspDate',      'label': 'Date / Time',         'kind': 'datetime'},
        {'key': 'siteName',      'label': 'Site',                'kind': 'text'},
        {'key': 'meterReading',  'label': None,                  'kind': 'meter'},
    ],
    'footer': [
        {'key': 'overallNotes', 'label': 'Overall Notes', 'kind': 'textarea'},
        {'key': 'signName',     'label': 'Signature (type your name)', 'kind': 'text'},
    ],
    'perItem': {'result': 'resultChoices', 'note': 'textarea'},
    'types': dict(TYPES, fallprotection=FALLPROTECTION),
    'typeOrder': ['rig', 'truck', 'pickup', 'forklift', 'supportequip', 'crane',
                  'fallprotection'],
}

# ---- the gate ---------------------------------------------------------
# Counts first, because a dropped line is the failure this project keeps
# having and it looks exactly like success.
problems = []
for t, secs in LIVE_COUNTS.items():
    got = TYPES[t]['sections']
    if list(got.keys()) != list(secs.keys()):
        problems.append(f'{t}: section names or order differ\n  live {list(secs)}\n  here {list(got)}')
    for s, n in secs.items():
        have = len(got.get(s, []))
        if have != n:
            problems.append(f'{t} / {s}: live has {n} items, transcription has {have}')
for f, secs in LIVE_COUNTS_FP.items():
    got = FALLPROTECTION['byFrequency'][f]
    if list(got.keys()) != list(secs.keys()):
        problems.append(f'fallprotection/{f}: section names or order differ')
    for s, n in secs.items():
        have = len(got.get(s, []))
        if have != n:
            problems.append(f'fallprotection / {f} / {s}: live {n}, here {have}')

# no blank or duplicated item inside a section
for t, d in TEMPLATE['types'].items():
    buckets = [d['sections']] if 'sections' in d else list(d['byFrequency'].values())
    for b in buckets:
        for s, items in b.items():
            for it in items:
                if not it.strip():
                    problems.append(f'{t} / {s}: a blank item')
            if len(set(items)) != len(items):
                problems.append(f'{t} / {s}: a duplicated item')

if problems:
    print('FAILED - template does NOT match the live form:')
    for p in problems:
        print('  ' + p)
    raise SystemExit(1)

total = sum(len(v) for t, d in TEMPLATE['types'].items()
            for b in ([d['sections']] if 'sections' in d else d['byFrequency'].values())
            for v in b.values())
live_total = sum(sum(s.values()) for s in LIVE_COUNTS.values()) + \
             sum(sum(s.values()) for s in LIVE_COUNTS_FP.values())
assert total == live_total, f'{total} != {live_total}'

out = pathlib.Path(__file__).with_name('preop.v1.json')
out.write_text(json.dumps(TEMPLATE, ensure_ascii=False, indent=1), encoding='utf-8')
print(f'OK  {len(TEMPLATE["types"])} equipment types, '
      f'{total} checklist lines, matches the live form on every count')
print(f'    -> {out}  ({out.stat().st_size:,} bytes)')
