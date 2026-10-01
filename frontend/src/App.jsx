import {useState,useEffect} from 'react';
const API='http://localhost:5000/api';
async function call(path,method='GET',body,token){
  const r=await fetch(API+path,{method,headers:{'Content-Type':'application/json',...(token&&{Authorization:'Bearer '+token})},body:body&&JSON.stringify(body)});
  const d=await r.json().catch(()=>({}));
  if(r.status===401&&token) window.dispatchEvent(new Event('logout'));
  if(!r.ok) throw new Error(d.message||'Request failed ('+r.status+')');
  return d;
}
const left=t=>{const ms=new Date(t)-Date.now();if(ms<=0)return 'Final results';const m=Math.floor(ms/60000),d=Math.floor(m/1440),h=Math.floor(m%1440/60);return d?`${d}d ${h}h left`:h?`${h}h ${m%60}m left`:`${Math.max(1,m)}m left`};

function Auth({onToken}){
  const [mode,setMode]=useState('signin'),[f,setF]=useState({name:'',username:'',email:'',password:'',usernameOrEmail:''}),[err,setErr]=useState(''),[hint,setHint]=useState({});
  const set=k=>e=>setF({...f,[k]:e.target.value});
  const check=async k=>{if(mode!=='signup'||!f[k])return;try{const d=await call(`/auth/check?${k}=${encodeURIComponent(f[k])}`);setHint(h=>({...h,[k]:d.taken?`This ${k} is already taken`:''}))}catch{}};
  const go=async()=>{try{const body=mode==='signin'?{usernameOrEmail:f.usernameOrEmail,password:f.password}:f;const d=await call('/auth/'+mode,'POST',body);onToken(d.token)}catch(e){setErr(e.message)}};
  const inp=(k,ph,type='text')=><><input type={type} placeholder={ph} value={f[k]} onChange={set(k)} onBlur={()=>(k==='username'||k==='email')&&check(k)}/>{hint[k]&&<div className="err">{hint[k]}</div>}</>;
  return <div className="card"><h2>{mode==='signin'?'Sign in':'Create account'}</h2>
    {mode==='signup'?<>{inp('name','Full name')}{inp('username','Username')}{inp('email','Email')}</>:inp('usernameOrEmail','Username or email')}
    {inp('password','Password','password')}
    {err&&<div className="err">{err}</div>}
    <button onClick={go}>{mode==='signin'?'Sign in':'Sign up'}</button>
    <button className="alt" onClick={()=>{setMode(mode==='signin'?'signup':'signin');setErr('')}}>{mode==='signin'?'New here? Sign up':'Have an account? Sign in'}</button></div>;
}
function NewPoll({token,onDone}){
  const [q,setQ]=useState(''),[cs,setCs]=useState(['','']),[days,setDays]=useState(1),[hours,setHours]=useState(0),[err,setErr]=useState('');
  const save=async()=>{try{await call('/polls','POST',{question:q,choices:cs,expiry:{days,hours}},token);onDone()}catch(e){setErr(e.message)}};
  return <div className="card"><h3>New poll</h3>
    <input maxLength={140} placeholder="Question" value={q} onChange={e=>setQ(e.target.value)}/>
    {cs.map((c,i)=><div className="row" key={i}><input maxLength={40} placeholder={'Choice '+(i+1)} value={c} onChange={e=>setCs(cs.map((x,j)=>j===i?e.target.value:x))}/>
      {cs.length>2&&<button className="alt" onClick={()=>setCs(cs.filter((_,j)=>j!==i))}>Remove</button>}</div>)}
    {cs.length<6&&<button className="alt" onClick={()=>setCs([...cs,''])}>Add choice</button>}
    <div className="row2"><label>Days<input type="number" min="0" max="365" value={days} onChange={e=>setDays(+e.target.value)}/></label>
      <label>Hours<input type="number" min="0" max="23" value={hours} onChange={e=>setHours(+e.target.value)}/></label></div>
    {err&&<div className="err">{err}</div>}
    <button onClick={save}>Create poll</button></div>;
}
function PollCard({poll,token,me,onChange,onDelete,onProfile}){
  const [err,setErr]=useState('');
  const show=poll.expired||poll.selected;
  const total=poll.choices.reduce((s,c)=>s+c.votes,0);
  const vote=async id=>{try{onChange(await call(`/polls/${poll._id}/vote`,'POST',{choiceId:id},token))}catch(e){setErr(e.message)}};
  const del=async()=>{if(!confirm('Delete this poll?'))return;try{await call(`/polls/${poll._id}`,'DELETE',null,token);onDelete(poll._id)}catch(e){setErr(e.message)}};
  return <div className="card">
    {poll.creator&&<div className="muted"><button className="link" onClick={()=>onProfile(poll.creator.username)}>{poll.creator.name}</button> @{poll.creator.username}</div>}
    <b>{poll.question}</b>
    {poll.choices.map(c=>{const pct=total?Math.round(c.votes*100/total):0;
      return <div key={c._id} className={'bar'+(poll.selected===c._id?' sel':'')}>{show&&<i style={{width:pct+'%'}}/>}
        <span><button className="alt" disabled={!!show} onClick={()=>vote(c._id)}>{c.text}</button>{show&&<em>{c.votes} ({pct}%)</em>}</span></div>})}
    <div className="top muted"><span>{total} vote{total===1?'':'s'} · {left(poll.expiresAt)}</span>
      {me&&poll.creator&&poll.creator._id===me._id&&<button className="danger" onClick={del}>Delete</button>}</div>
    {err&&<div className="err">{err}</div>}</div>;
}
function PollList({url,token,me,onProfile}){
  const [polls,setPolls]=useState([]),[last,setLast]=useState(true),[page,setPage]=useState(0),[busy,setBusy]=useState(false),[err,setErr]=useState('');
  const load=async p=>{setBusy(true);try{const d=await call(`${url}?page=${p}&size=5`,'GET',null,token);setPolls(p?x=>[...x,...d.polls]:d.polls);setPage(p);setLast(d.last);setErr('')}catch(e){setErr(e.message)}setBusy(false)};
  useEffect(()=>{load(0)},[url,token]);
  return <>{err&&<div className="err">{err}</div>}
    {!busy&&!polls.length&&!err&&<div className="card">No polls here yet.</div>}
    {polls.map(p=><PollCard key={p._id} poll={p} token={token} me={me} onProfile={onProfile}
      onChange={np=>setPolls(x=>x.map(y=>y._id===np._id?np:y))} onDelete={id=>setPolls(x=>x.filter(y=>y._id!==id))}/>)}
    {!last&&<button disabled={busy} onClick={()=>load(page+1)}>{busy?'Loading...':'Load more'}</button>}</>;
}
function Profile({username,token,me,onProfile}){
  const [u,setU]=useState(null),[tab,setTab]=useState('polls'),[err,setErr]=useState('');
  useEffect(()=>{setU(null);setErr('');call('/users/'+username,'GET',null,token).then(setU).catch(e=>setErr(e.message))},[username]);
  if(err) return <div className="card err">{err}</div>;
  if(!u) return <div className="card">Loading...</div>;
  return <><div className="card"><h2>{u.name}</h2><div className="muted">@{u.username} · Joined {new Date(u.joinedAt).toLocaleDateString()}</div>
    <p>{u.pollCount} polls · {u.voteCount} votes</p>
    <button className={tab==='polls'?'':'alt'} onClick={()=>setTab('polls')}>Polls</button>
    <button className={tab==='votes'?'':'alt'} onClick={()=>setTab('votes')}>Votes</button></div>
    <PollList key={username+tab} url={`/users/${u.username}/${tab}`} token={token} me={me} onProfile={onProfile}/></>;
}
export default function App(){
  const [token,setToken]=useState(localStorage.getItem('token')),[me,setMe]=useState(null),[view,setView]=useState({name:'home'}),[n,setN]=useState(0);
  const logout=()=>{localStorage.removeItem('token');setToken(null);setMe(null);setView({name:'home'})};
  useEffect(()=>{window.addEventListener('logout',logout);return()=>window.removeEventListener('logout',logout)},[]);
  useEffect(()=>{if(token)call('/me','GET',null,token).then(setMe).catch(()=>{})},[token]);
  const login=t=>{localStorage.setItem('token',t);setToken(t)};
  const go=(name,username)=>setView({name,username});
  const tabBtn=(name,label,username)=><button className={view.name===name&&(!username||view.username===username)?'on alt':'alt'} onClick={()=>go(name,username)}>{label}</button>;
  return <div className="wrap"><div className="top"><h1>Polls</h1>{token&&<button className="alt" onClick={logout}>Log out</button>}</div>
    {!token?<Auth onToken={login}/>:<>
      <div className="nav">{tabBtn('home','Home')}{tabBtn('new','New poll')}{me&&tabBtn('profile','My profile',me.username)}</div>
      {view.name==='home'&&<PollList key={n} url="/polls" token={token} me={me} onProfile={u=>go('profile',u)}/>}
      {view.name==='new'&&<NewPoll token={token} onDone={()=>{setN(n+1);go('home')}}/>}
      {view.name==='profile'&&<Profile username={view.username} token={token} me={me} onProfile={u=>go('profile',u)}/>}</>}</div>;
}
