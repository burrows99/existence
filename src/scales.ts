import type { ComponentType } from 'react'
import { Placeholder } from './layers/Placeholder'

export type Scale = {
  id: string
  size: number // log10 of the thing's diameter in metres
  label: string
  fact: string
  color: string
  speculative?: boolean
  Component: ComponentType<{ color: string }> // drawn so that 1 unit = its diameter
}

export const MIN_ZOOM = -35
export const MAX_ZOOM = 27.5

export const SCALES: Scale[] = [
  { id: 'planck', size: -34.8, label: 'Planck length', color: '#b48cff', speculative: true, Component: Placeholder,
    fact: '1.6 × 10⁻³⁵ m. Below this, known physics stops working. Theoretical, never observed.' },
  { id: 'quark', size: -17.4, label: 'Quarks', color: '#ff5a5a', Component: Placeholder,
    fact: 'No measured size: they behave as points. Experiments say a quark is smaller than 4 × 10⁻¹⁸ m.' },
  { id: 'proton', size: -14.8, label: 'Proton', color: '#ff9f43', Component: Placeholder,
    fact: 'Three quarks (up, up, down) held by gluons. About 1.7 femtometres across.' },
  { id: 'nucleus', size: -14.2, label: 'Carbon nucleus', color: '#feca57', Component: Placeholder,
    fact: '6 protons and 6 neutrons. Holds 99.97% of the atom’s mass in a trillionth of its volume.' },
  { id: 'atom', size: -10, label: 'Hydrogen atom', color: '#48dbfb', Component: Placeholder,
    fact: 'One electron in a probability cloud about 0.1 nm across. Almost entirely empty space.' },
  { id: 'dna', size: -8.7, label: 'DNA', color: '#1dd1a1', Component: Placeholder,
    fact: 'The double helix is 2 nm wide. Unwound, one cell’s DNA would be about 2 m long.' },
  { id: 'virus', size: -7, label: 'Virus', color: '#ff6b81', Component: Placeholder,
    fact: 'An influenza virus is about 100 nm: a protein shell around a few genes.' },
  { id: 'cell', size: -4.7, label: 'Human cell', color: '#f368e0', Component: Placeholder,
    fact: 'About 20 µm. You are made of roughly 37 trillion of them.' },
  { id: 'human', size: 0.24, label: 'Human', color: '#c8d6e5', Component: Placeholder,
    fact: 'About 1.7 m tall, right in the middle of the scale of everything.' },
  { id: 'earth', size: 7.1, label: 'Earth', color: '#2e86de', Component: Placeholder,
    fact: '12,742 km across. The only place life is known to exist.' },
  { id: 'sun', size: 9.14, label: 'Sun', color: '#ffd32a', Component: Placeholder,
    fact: '1.39 million km across: 109 Earths side by side.' },
  { id: 'solar', size: 12.95, label: 'Solar system', color: '#f6e58d', Component: Placeholder,
    fact: 'Neptune’s orbit spans 60 AU. Light takes about 8 hours to cross it.' },
  { id: 'stars', size: 17.2, label: 'Nearest stars', color: '#dff9fb', Component: Placeholder,
    fact: 'Proxima Centauri, the nearest star, is 4.24 light-years away.' },
  { id: 'milkyway', size: 21, label: 'Milky Way', color: '#c7ecee', Component: Placeholder,
    fact: 'About 100,000 light-years across, with 100–400 billion stars.' },
  { id: 'localgroup', size: 23, label: 'Local Group', color: '#7ed6df', Component: Placeholder,
    fact: 'About 80 galaxies within 10 million light-years, dominated by the Milky Way and Andromeda.' },
  { id: 'laniakea', size: 24.7, label: 'Laniakea Supercluster', color: '#e056fd', Component: Placeholder,
    fact: 'About 100,000 galaxies spanning 520 million light-years. Our home supercluster.' },
  { id: 'universe', size: 26.94, label: 'Observable universe', color: '#686de0', Component: Placeholder,
    fact: '93 billion light-years across: as far as light has had time to reach us since the Big Bang.' },
]
