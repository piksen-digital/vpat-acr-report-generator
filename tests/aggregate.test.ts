import { describe, expect, it } from 'vitest';
import { aggregate, type PageScan } from '../src/main';
import mapping from '../mapping/wcag22-aa-mapping.json';

const criteria: any[] = (mapping as any).criteria;

const scanWith = (tag: string, result: 'violations' | 'passes' | 'incomplete'): PageScan => ({
    url: 'https://fixture.local/index.html',
    violations: [], passes: [], incomplete: [],
    [result]: [{ id: 'test-rule', help: 'Test rule', impact: 'serious', tags: [tag], nodeCount: 1 }],
});

describe('aggregate verdicts (honesty rules)', () => {
    it('flags Does Not Support when axe finds violations for the SC tag', () => {
        const r = aggregate(criteria.find((c) => c.sc === '1.1.1'), [scanWith('wcag111', 'violations')]);
        expect(r.verdict).toBe('Does Not Support');
    });

    it('never claims Supports for partially automatable criteria', () => {
        const r = aggregate(criteria.find((c) => c.sc === '1.3.1'), [scanWith('wcag131', 'passes')]);
        expect(r.verdict).toBe('No Violations Detected');
    });

    it('claims Supports only for fully automatable criteria with clean passes', () => {
        const r = aggregate(criteria.find((c) => c.sc === '2.4.2'), [scanWith('wcag242', 'passes')]);
        expect(r.verdict).toBe('Supports');
    });

    it('renders criteria with no automated coverage as Not Evaluated, even if injected findings exist', () => {
        const r = aggregate(criteria.find((c) => c.sc === '2.2.1'), [scanWith('wcag221', 'violations')]);
        expect(r.verdict).toBe('Not Evaluated');
    });

    it('demands manual assessment when axe checks are incomplete', () => {
        const r = aggregate(criteria.find((c) => c.sc === '1.1.1'), [scanWith('wcag111', 'incomplete')]);
        expect(r.verdict).toBe('Requires Manual Assessment');
    });

    it('requires manual assessment when automated coverage exists but produced no evidence', () => {
        const r = aggregate(criteria.find((c) => c.sc === '1.1.1'), [{
            url: 'https://fixture.local/clean.html', violations: [], passes: [], incomplete: [],
        }]);
        expect(r.verdict).toBe('Requires Manual Assessment');
    });
});
