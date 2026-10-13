import {render,screen} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {SocialHub} from './SocialHub';
beforeEach(()=>{window.orbitqa={...(window.orbitqa||{}),listSocialAccounts:async()=>[],listSocialTargets:async()=>[],listSocialRuns:async()=>[],onSocialEvent:()=>()=>{}} as typeof window.orbitqa;});
it('renders Social Hub with bulk targets and safe interaction checks',async()=>{render(<SocialHub view="qa"/>);expect(screen.getByText('Social Hub')).toBeInTheDocument();expect(screen.getByText('Add social links in bulk')).toBeInTheDocument();expect(screen.getByText('Comment composer readiness')).toBeInTheDocument();expect(screen.getByText('Public actions stay manual.')).toBeInTheDocument();expect(screen.getByRole('button',{name:'SELECT ALL'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'DELETE ALL'})).toBeInTheDocument();});
