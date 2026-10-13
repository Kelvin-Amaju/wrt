import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('application shell', () => {
  it('shows the dashboard by default', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Website QA command center')).toBeInTheDocument();
  });

  it('changes page when a sidebar item is selected', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Proxy Manager/i }));
    expect(screen.getByRole('heading', { name: 'Proxy Manager', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test All' })).toBeInTheDocument();
  });

  it('opens the lightweight Proxy IP History page from the sidebar', async () => {
    Object.defineProperty(window,'orbitqa',{configurable:true,value:{
      listQaRuns: async () => [],
      listProxyIpHistory: async () => ({ page:1,pageSize:100,total:0,totalPages:1,summary:{uniqueIps:0,repeatedIps:0,countries:0,totalObservations:0},rows:[] }),
    }});
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Proxy IP History/i }));
    expect(await screen.findByRole('heading', { name: 'Proxy IP History', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Total Observations')).toBeInTheDocument();
  });
});
