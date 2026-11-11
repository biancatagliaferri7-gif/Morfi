-- PostgreSQL time accepts 24:00; use 00:00 to avoid empty overnight windows.
begin;
create or replace function morfi_private.validate_hours(p_hours jsonb)
returns void language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(p_hours) is distinct from 'array' or jsonb_array_length(p_hours) not between 1 and 14 then raise exception 'Choose at least one opening time'; end if;
 if exists(select 1 from jsonb_to_recordset(p_hours) as h(weekday integer,slot integer,opens time,closes time) where weekday is null or weekday not between 0 and 6 or slot is null or slot not in(0,1) or opens is null or closes is null or opens=closes or opens>=time '24:00' or closes>=time '24:00') then raise exception 'Invalid opening hours'; end if;
 if exists(select 1 from jsonb_to_recordset(p_hours) as h(weekday integer,slot integer) group by weekday,slot having count(*)>1) then raise exception 'Duplicate opening hours'; end if;
 if exists(
 with slots as(select weekday*1440+extract(epoch from opens)/60 as starts,weekday*1440+extract(epoch from closes)/60+case when closes<opens then 1440 else 0 end as ends from jsonb_to_recordset(p_hours) as h(weekday integer,opens time,closes time)),
 wrapped as(select * from slots union all select starts+10080,ends+10080 from slots)
 select 1 from wrapped a join wrapped b on a.starts<b.starts where a.ends>b.starts
 ) or exists(select 1 from jsonb_to_recordset(p_hours) as h(weekday integer,opens time) group by weekday,opens having count(*)>1) then raise exception 'Opening times overlap';end if;
end $$;
revoke all on function morfi_private.validate_hours(jsonb) from public,anon,authenticated;
commit;
