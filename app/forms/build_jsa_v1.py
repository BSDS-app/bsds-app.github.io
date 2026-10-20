#!/usr/bin/env python3
"""Lift the JSA off the live app, verbatim, into a versioned template.

Same rules as build_preop_v1.py, and for the same reason: this is a COPY.
Every label, option and checklist line below was read out of
https://bsds-app.github.io/jsa/ on 20 Oct 2026 by parsing the page's own
HAZARD_CATEGORIES / PPE_ITEMS / LOTO_ENERGY_SOURCES / PERMIT_CARD_IDS
literals and reading the rendered labels back off the form.

The JSA is a bigger animal than the pre-op. It is not one checklist - it is
a hazard review that CONDITIONALLY opens a permit. Three of the twelve MSHA
hazard categories are permit triggers: answer YES to hot work, heights or
confined space and a permit card has to be filled in before the JSA can be
signed. That conditional behaviour is the part worth getting exactly right,
because a JSA that lets a man sign off on confined-space entry without the
atmospheric readings is worse than no JSA at all.

Counts are asserted at the bottom against the counts read off the live page
BEFORE the labels were transcribed.

v1 == the form as it stood on 20 Oct 2026. Records store the version they
were signed on and render against it.
"""
import json
import pathlib

# ---- counts read off the live page first (the gate) ------------------
LIVE = {
    'hazards': 12,
    'permit_hazards': 3,
    'ppe': 11,
    'loto_sources': 5,
    'header': 6,
    'hw': 10,
    'hp': 14,
    'cs': 13,
    'loto_fields': 4,
    'harness': 6,
    'step_columns': 3,
    'signoff': 3,
}

HAZARDS = [
    ('stored_energy', 'Stored Energy — Hydraulic / Pneumatic / Spring / Gravity', None),
    ('electrical',    'Electrical Hazards', None),
    ('pinch',         'Pinch Points / Caught-In or Between', None),
    ('lineoffire',    'Line of Fire / Overhead Hazards', None),
    ('heights',       'Fall from Height / Elevated Work', 'heights'),
    ('hotwork',       'Hot Work (Welding / Cutting / Grinding)', 'hotwork'),
    ('confined',      'Confined Space Entry', 'confined'),
    ('chemical',      'Chemical / Hazardous Materials Exposure', None),
    ('noise',         'Noise Exposure', None),
    ('heatcold',      'Heat / Cold Stress (Environmental)', None),
    ('lifting',       'Lifting / Ergonomic Strain', None),
    ('ground',        'Ground Conditions / Mobile Equipment Traffic', None),
]

PPE = [
    'Hard hat',
    'Safety glasses / goggles',
    'Hearing protection',
    'High-visibility clothing',
    'Steel-toe / composite-toe boots',
    'Work gloves (task-appropriate)',
    'Fall protection harness & lanyard',
    'Respiratory protection',
    'Face shield',
    'Fire-resistant clothing',
    'Seat belt (if operating mobile equipment)',
]

LOTO_SOURCES = ['Electrical', 'Hydraulic', 'Pneumatic', 'Mechanical / Gravity',
                'Thermal / Stored Pressure']

HARNESS = [
    'Webbing — no cuts, frays, burns, or chemical damage',
    'Stitching intact, no pulled or broken threads',
    'D-rings — no cracks, distortion, or excessive wear',
    'Buckles / friction buckles function properly',
    'Labels/tags legible (capacity, manufacture date)',
    'Snap hooks / carabiners — gate closes and locks properly',
]


def f(key, label, kind, **kw):
    d = {'key': key, 'label': label, 'kind': kind}
    d.update(kw)
    return d


HEADER = [
    f('jsaTech',      'Technician',                  'tech'),
    f('jsaDate',      'Date / Time',                 'datetime', req=True),
    f('jsaSite',      'Mine Site / Location',        'text',     req=True),
    f('jsaEquipment', 'Equipment / Asset Involved',  'unit'),
    f('jsaTaskDesc',  'Task Description',            'textarea', req=True),
    f('jsaCrew',      'Crew Members Present',        'text'),
]

# Hot work. Everything here is required once the permit is open - a hot-work
# permit with a blank fire-watch line is not a permit.
HOTWORK = [
    f('hwLocation',            'Location of Hot Work', 'text', req=True),
    f('hwDescription',         'Description of Work',  'text', req=True),
    f('hwExtinguisher',        'Fire extinguisher on site & charged', 'check', req=True),
    f('hwCombustiblesCleared', 'Area cleared of combustibles within 35 ft',
      'check', req=True),
    f('hwFireWatch',           'Fire watch assigned during and 30 min after work',
      'check', req=True),
    f('hwFireWatchName',       'Fire Watch Name', 'text', req=True),
    f('hwGasTested',           'Gas/Atmosphere Tested (if enclosed area)', 'select',
      options=[{'value': 'na', 'label': 'N/A'}, {'value': 'yes', 'label': 'Yes'},
               {'value': 'no', 'label': 'No'}]),
    f('hwValidFrom',           'Permit Valid From', 'time', req=True),
    f('hwValidTo',             'Permit Valid To',   'time', req=True),
    f('hwAuthorizedBy',        'Authorized By',     'text', req=True),
]

HEIGHTS = [
    f('hpHeight', 'Height of Work (ft)', 'text', req=True),
    f('hpMethod', 'Fall Protection Method', 'select', req=True, options=[
        {'value': 'pfas', 'label': 'Personal Fall Arrest System (harness/lanyard)'},
        {'value': 'guardrails', 'label': 'Guardrails'},
        {'value': 'net', 'label': 'Safety Net'},
        {'value': 'controlzone', 'label': 'Warning Line / Controlled Access Zone'},
    ]),
    f('hpAnchorDescription', 'Anchor Point Description / Location', 'text',
      group='Anchor Point', req=True),
    f('hpAnchorRated',
      'Anchor point inspected and confirmed rated for at least 5,000 lbs',
      'check', group='Anchor Point', req=True),
] + [
    f('hpHarness%d' % (i + 1), HARNESS[i], 'check', group='Harness Inspection', req=True)
    for i in range(6)
] + [
    f('hpRescuePlanText', 'Describe the rescue plan for this task', 'textarea',
      group='Rescue Plan', req=True),
    f('hpWindSpeed', 'Wind Speed (mph)', 'text', group='Weather / Wind Conditions'),
    f('hpWeatherConditions', 'Weather Conditions', 'text',
      group='Weather / Wind Conditions'),
    f('hpAuthorizedBy', 'Authorized By', 'text', req=True),
]

CONFINED = [
    f('csSpaceName', 'Space Name / Identification', 'text', req=True),
    f('csEntrants',  'Number of Entrants', 'number', req=True),
    f('csOxygen', 'Oxygen %',   'text', group='Atmospheric Testing', req=True),
    f('csLEL',    'LEL %',      'text', group='Atmospheric Testing', req=True),
    f('csCO',     'CO (ppm)',   'text', group='Atmospheric Testing', req=True),
    f('csH2S',    'H2S (ppm)',  'text', group='Atmospheric Testing', req=True),
    f('csVentilation', 'Continuous ventilation in place', 'check', req=True),
    f('csSupervisor', 'Entry Supervisor', 'text', req=True),
    f('csAttendant',  'Attendant (outside space)', 'text', req=True),
    f('csRescueReady', 'Rescue/retrieval equipment ready', 'check', req=True),
    f('csCommMethod', 'Communication Method', 'text', req=True),
    f('csValidFrom', 'Permit Valid From', 'time', req=True),
    f('csValidTo',   'Permit Valid To',   'time', req=True),
]

LOTO_FIELDS = [
    f('lotoRequired', 'Is Lockout/Tagout required for this task?', 'select', options=[
        {'value': 'no', 'label': 'No'}, {'value': 'yes', 'label': 'Yes'}]),
    f('lotoZeroEnergy', 'Zero energy state verified before work begins', 'check',
      whenLoto=True, req=True),
    f('lotoAppliedBy', 'Locks/Tags Applied By', 'text', whenLoto=True, req=True),
    f('lotoLockCount', '# of Locks/Tags Applied', 'number', whenLoto=True, req=True),
]

SIGNOFF = [
    f('preparedBy', 'JSA Prepared By (typed signature)', 'text', req=True),
    f('supervisorReview', 'Supervisor / Competent Person Review (optional)', 'text'),
    f('crewAckCheck',
      'All crew members listed above were present for this JSA review and '
      'understand the hazards and controls identified.', 'check', req=True),
]

TEMPLATE = {
    'form': 'jsa',
    'version': 1,
    'effective': '2026-10-20',
    'liftedFrom': 'https://bsds-app.github.io/jsa/',
    'note': ('Verbatim copy of the JSA as it stood on 20 Oct 2026. Records store '
             'this version number so they render with the form they were signed on.'),
    'title': 'Job Safety Analysis',
    'statusChoices': [
        {'value': 'no', 'label': 'NO'},
        {'value': 'yes', 'label': 'YES'},
        {'value': 'na', 'label': 'N/A'},
    ],
    'sectionTitles': {
        'header': 'Job Details',
        'hazards': 'MSHA Hazard Category Review',
        'ppe': 'Required PPE',
        'loto': 'Lockout / Tagout (LOTO)',
        'lotoSources': 'Energy Sources Isolated',
        'steps': 'Job Steps, Hazards & Controls',
        'reflection': 'Daily Risk Reflection',
        'signoff': 'Sign-Off',
    },
    'header': HEADER,
    'hazards': [{'key': k, 'label': l, **({'permit': p} if p else {})}
                for k, l, p in HAZARDS],
    'controlsPrompt': 'Controls / precautions (required if YES)',
    'permits': {
        'hotwork':  {'title': 'Hot Work Permit',            'fields': HOTWORK},
        'heights':  {'title': 'Working at Heights Permit',  'fields': HEIGHTS},
        'confined': {'title': 'Confined Space Entry Permit', 'fields': CONFINED},
    },
    'permitOrder': ['hotwork', 'heights', 'confined'],
    'ppe': PPE,
    'loto': {'fields': LOTO_FIELDS, 'sources': LOTO_SOURCES},
    'steps': {
        'minRows': 2,
        'columns': [
            {'key': 'desc', 'label': 'Job Step Description',
             'placeholder': 'e.g. Remove hydraulic hose from cylinder'},
            {'key': 'haz', 'label': 'Potential Hazards',
             'placeholder': 'e.g. Residual hydraulic pressure, hot fluid'},
            {'key': 'ctl', 'label': 'Controls / PPE Needed',
             'placeholder': 'e.g. Bleed pressure fully, wear face shield & gloves'},
        ],
    },
    'reflection': f('mostDangerousTask', "What's the most dangerous task of your day?",
                    'textarea', req=True),
    'signoff': SIGNOFF,
}

# ---- the gate --------------------------------------------------------
problems = []


def want(name, got):
    if got != LIVE[name]:
        problems.append(f'{name}: live has {LIVE[name]}, transcription has {got}')


want('hazards', len(TEMPLATE['hazards']))
want('permit_hazards', len([h for h in TEMPLATE['hazards'] if h.get('permit')]))
want('ppe', len(TEMPLATE['ppe']))
want('loto_sources', len(TEMPLATE['loto']['sources']))
want('header', len(TEMPLATE['header']))
want('hw', len(TEMPLATE['permits']['hotwork']['fields']))
want('hp', len(TEMPLATE['permits']['heights']['fields']))
want('cs', len(TEMPLATE['permits']['confined']['fields']))
want('loto_fields', len(TEMPLATE['loto']['fields']))
want('harness', len([x for x in TEMPLATE['permits']['heights']['fields']
                     if x.get('group') == 'Harness Inspection']))
want('step_columns', len(TEMPLATE['steps']['columns']))
want('signoff', len(TEMPLATE['signoff']))

# every permit a hazard names must exist, and every permit must be reachable
named = {h['permit'] for h in TEMPLATE['hazards'] if h.get('permit')}
for p in named:
    if p not in TEMPLATE['permits']:
        problems.append(f'hazard names permit "{p}" which does not exist')
for p in TEMPLATE['permits']:
    if p not in named:
        problems.append(f'permit "{p}" can never open - no hazard triggers it')
    if p not in TEMPLATE['permitOrder']:
        problems.append(f'permit "{p}" is not in permitOrder')

# no duplicate keys anywhere - a collision silently loses an answer
keys = ([x['key'] for x in TEMPLATE['header']]
        + [x['key'] for x in TEMPLATE['loto']['fields']]
        + [x['key'] for x in TEMPLATE['signoff']]
        + [TEMPLATE['reflection']['key']]
        + [x['key'] for p in TEMPLATE['permits'].values() for x in p['fields']])
dupes = sorted({k for k in keys if keys.count(k) > 1})
if dupes:
    problems.append('duplicated field keys: ' + ', '.join(dupes))

hkeys = [h['key'] for h in TEMPLATE['hazards']]
if len(set(hkeys)) != len(hkeys):
    problems.append('duplicated hazard keys')
for name, items in (('ppe', TEMPLATE['ppe']), ('loto sources', TEMPLATE['loto']['sources']),
                    ('harness', HARNESS)):
    if len(set(items)) != len(items):
        problems.append(f'{name} has a repeated line')
    if any(not str(x).strip() for x in items):
        problems.append(f'{name} has a blank line')

for x in keys:
    if not x.strip():
        problems.append('a field with no key')
for p, spec in TEMPLATE['permits'].items():
    for x in spec['fields']:
        if not x['label'].strip():
            problems.append(f'{p}: a field with no label')

if problems:
    print('FAILED - template does NOT match the live form:')
    for x in problems:
        print('  ' + x)
    raise SystemExit(1)

out = pathlib.Path(__file__).with_name('jsa.v1.json')
out.write_text(json.dumps(TEMPLATE, ensure_ascii=False, indent=1), encoding='utf-8')
total = len(keys) + len(TEMPLATE['hazards']) + len(TEMPLATE['ppe']) \
    + len(TEMPLATE['loto']['sources'])
print(f'OK  12 hazard categories, 3 conditional permits, {len(TEMPLATE["ppe"])} PPE lines, '
      f'{total} answerable items, matches the live form on every count')
print(f'    -> {out}  ({out.stat().st_size:,} bytes)')
