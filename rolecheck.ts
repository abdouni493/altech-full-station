import { supabase } from './src/lib/supabase';
(async () => {
  const t0 = Date.now();
  const { data, error } = await supabase.rpc('get_my_role');
  console.log(`get_my_role -> ${Date.now()-t0}ms  data=${JSON.stringify(data)}  err=${error?.code || '-'} ${error?.message?.slice(0,70) || ''}`);
  const t1 = Date.now();
  await supabase.from('admin_profiles').select('role').limit(1);
  console.log(`admin_profiles -> ${Date.now()-t1}ms`);
  const t2 = Date.now();
  await supabase.from('module_workers').select('id').limit(1);
  console.log(`module_workers -> ${Date.now()-t2}ms`);
  process.exit(0);
})();
