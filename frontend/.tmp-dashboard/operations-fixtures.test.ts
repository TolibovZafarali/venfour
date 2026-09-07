import { describe, expect, it } from 'vitest';
import { createSyntheticOperationsService } from './operations-fixtures';
import { cases, detail } from './fixtures';
import type { AdminResource } from '@/features/admin/operations/types';

describe('synthetic admin operational projections', () => {
  it.each(['cases','customers','reports','processing','payments','activity'] as AdminResource[])('validates the populated %s list through shared runtime contracts', async resource => {
    const result=await createSyntheticOperationsService('populated').list(resource);
    expect(result.total).toBeGreaterThan(0);
    expect(result.items.every(item=>item.sections.length===0)).toBe(true);
  });

  it('keeps overview and active-processing filter counts equal without counting historical failures or completed jobs',async()=>{
    const service=createSyntheticOperationsService('populated');
    const overview=await service.overview();
    const processing=await service.list('processing',{filters:{active:'true'}});
    expect(processing.total).toBe(overview.processingJobs);
    expect(processing.items.map(item=>item.status)).toEqual(['processing']);
    const inactive=await service.list('processing',{filters:{active:'false'}});
    expect(inactive.items.some(item=>item.status==='completed')).toBe(true);
    expect(inactive.items.some(item=>item.facts.some(fact=>fact.label==='Current'&&fact.value==='false'))).toBe(true);
  });

  it('keeps event timestamps, uploaded source state, and guest identity provenance coherent',async()=>{
    const service=createSyntheticOperationsService('populated');
    const events=await service.list('activity');
    for(const event of events.items)expect(event.createdAt).toBe(event.facts.find(fact=>fact.label==='Recorded at')?.value);
    const uploads=await service.list('reports',{filters:{kind:'uploaded'}});
    expect(uploads.items.every(item=>item.status==='uploaded')).toBe(true);
    expect(uploads.items.every(item=>item.facts.some(fact=>fact.label==='Extraction status'&&fact.value==='confirmed'))).toBe(true);
    expect(cases.find(item=>item.ownerIsAnonymous)?.customerFullName).toBeNull();
    const guests=await service.list('customers',{filters:{identity:'guest'}});
    expect(guests.items[0].facts.find(fact=>fact.label==='Confirmed name')?.value).toBeNull();
  });

  it('supplies matching vehicle and intake details for every case on both large-list pages',async()=>{
    const service=createSyntheticOperationsService('large');
    const first=await service.list('cases');
    const second=await service.list('cases',{page:2});
    expect(first.total).toBe(63);
    expect(second.total).toBe(63);
    const items=[...first.items,...second.items];
    expect(new Set(items.map(item=>item.id)).size).toBe(63);
    for(const item of items){
      const legacy=detail(item.id);
      expect(legacy).not.toBeNull();
      expect(legacy?.caseId).toBe(item.id);
      expect([legacy?.vehicleYear,legacy?.vehicleMake,legacy?.vehicleModel,legacy?.vehicleTrim].filter(Boolean).join(' ')).toBe(item.summary);
      if(item.status==='waiting_human_review'){
        expect(legacy?.analysisStatus).toBe('completed');
        expect(legacy?.reportUploadedAt).not.toBeNull();
        expect(legacy?.intakeCompletedAt).not.toBeNull();
      }
      if(item.identity==='guest'){
        expect(legacy?.intakeMode).toBe('manual');
        expect(legacy?.intakeCompletedAt).toBeNull();
      }
    }
  });

  it('loads full operational metadata only through an expanded record request',async()=>{
    const service=createSyntheticOperationsService('populated');
    const payments=await service.list('payments');
    expect(payments.items[0].sections).toEqual([]);
    const expanded=await service.record('payments',payments.items[0].id);
    expect(expanded?.sections.length).toBeGreaterThan(0);
    expect(expanded?.facts.find(fact=>fact.label==='Mode')?.value).toBe('Test');
  });
});
