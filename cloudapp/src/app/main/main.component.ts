import { Subscription, forkJoin, Observable, of } from 'rxjs';
import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CloudAppRestService, CloudAppEventsService,
  Entity, PageInfo, RestErrorResponse, HttpMethod, Request } from '@exlibris/exl-cloudapp-angular-lib';
import {  MatSelectionList, MatListOption, MatSelectionListChange } from '@angular/material/list';
import { HttpHeaders, HttpClient } from '@angular/common/http';
import { concatMap, map, catchError} from 'rxjs/operators';
import { PriceResponse, PlaceOrderResponse } from '../models/response';
import { ConfigurationComponent } from '../configuration/configuration.component';
import { PartnerCodeService } from '../app.service';
import { MatTabChangeEvent } from '@angular/material/tabs';
 
@Component({
  selector: 'app-main',
  templateUrl: './main.component.html',
  styleUrls: ['./main.component.scss']
})
export class MainComponent implements OnInit, OnDestroy {
  @ViewChild('requests') requests: MatSelectionList;
  private pageLoad$: Subscription;
  loading = false;
  pricesLoaded = false;
  placeOrderEnded = false;
  pageEntities: Entity[];
  selectedEntities: Entity[];
  apiResult: any;
  showPlaceOrderSpinner = false;
  borrowingTaskList = false;
  validCredentials = true;
  requestIdToRequest = new Map();
  requestToPrice : Map<string,PriceResponse> = new Map<string,PriceResponse>();
  requestToOrder : Map<string,PlaceOrderResponse> = new Map<string,PlaceOrderResponse>();
  buttonVisibility : {[key:string]:boolean} = {};                                                                                              
  entities$: Observable<Entity[]> = this.eventsService.entities$
  partnerCode = this.partnerCodeService.getPartnerCode();                                                                                    
 
  constructor(
    private partnerCodeService: PartnerCodeService,
    private restService: CloudAppRestService,
    private eventsService: CloudAppEventsService,
    private http: HttpClient,
  ) {
 
 
  }
 
 
  ngOnInit() {
    this.pageLoad$ = this.eventsService.onPageLoad(this.onPageLoad);
    this.partnerCode = this.partnerCode ? this.partnerCode : "Reprints_Desk";                                                      
}
 
 
  ngOnDestroy(): void {
  }
 
 
  onPageLoad = (pageInfo: PageInfo) => {
    this.pageEntities = pageInfo.entities;
    if ((this.pageEntities || []).length > 0 && this.pageEntities[0].type === 'BORROWING_REQUEST') {
      this.requestIdToRequest.clear();
      this.requestToPrice.clear();
      this.requestToOrder.clear();
      this.loadEntities();
      this.credentialsCheck();
      this.entities$.subscribe(entities=>{              
        entities.forEach(entity => {
          this.buttonVisibility[entity.id] = true
        });
      });                                                
    }
  }
 
 
  loadEntities(){
    this.loading = true;
    let calls = [];
    this.pageEntities.forEach(entity => {
      
      if(!entity.link.includes("null")){
        calls.push(this.restService.call(entity.link))
      }else{
        console.log('Skipping request. User is null: ' + entity.id);
      }
    });
    forkJoin(calls).subscribe({
      next: (s: any[])=>{
        s.forEach(result=>{
          if (isRestErrorResponse(result)) {
            console.log('Error retrieving request: ' + result.message);
          } else {
            this.requestIdToRequest.set(result.request_id, result);
          }
        })
      },
      complete: () => this.loading = false,
      error: error => {
        console.log(error);
        this.loading = false
      }      
    });
  }
 
 
  loadPrices(){
    forkJoin({ initData: this.eventsService.getInitData(), authToken: this.eventsService.getAuthToken() }).pipe(concatMap((data) => {
      let url = data.initData.urls['alma'] + "view/ReprintsDeskCloudApp";
      let authHeader = "Bearer " + data.authToken;
      const headers = new HttpHeaders({ 'Authorization': authHeader});
 
      let calls = [];      
      this.pageEntities.forEach(entity => calls.push(this.http.post<any>(url + "?op=Order_GetPriceEstimate2&requestId=" + entity.id, [], { headers }).pipe(
        map((res) => this.requestToPrice.set(res.requestId, res)),
        catchError(e => of(e))
      )));
      return forkJoin(calls);
    })).subscribe({
      error: error => {
        console.log(error);
      }, complete: () => this.pricesLoaded = true
    });
  }
 
 
  credentialsCheck(){
    forkJoin({ initData: this.eventsService.getInitData(), authToken: this.eventsService.getAuthToken() }).pipe(concatMap((data) => {
      let url = data.initData.urls['alma'] + "view/ReprintsDeskCloudApp";
      let authHeader = "Bearer " + data.authToken;
      let requestId = this.pageEntities[0].id;
      const headers = new HttpHeaders({ 'Authorization': authHeader});
      return this.http.post<any>(url + "?op=Order_GetPriceEstimate2&requestId=" + requestId, [], { headers });
    })).subscribe({
      next: res => {
        if(res && res.errorMsg && res.errorMsg.toLowerCase() == "invalid user name or password"){
          this.validCredentials = false;
          this.pricesLoaded = true
        }else{
          this.loadPrices();
        }      
      },
      error: error => {
        console.log(error);
        this.validCredentials = false;
        this.pricesLoaded = true
      }
    });
  }
 
 
  onBulkPlaceOrderClicked(selectedOptions: MatListOption[]){
    let selectedRequests = selectedOptions.map(o => o.value);
    selectedRequests.forEach(entity => {
      this.buttonVisibility[entity.id] = false;
      let orderObject = new PlaceOrderResponse();
      orderObject.status = "loading";
      this.requestToOrder.set(entity.id, orderObject)
    });
    forkJoin({ initData: this.eventsService.getInitData(), authToken: this.eventsService.getAuthToken() }).pipe(concatMap((data) => {
      let url = data.initData.urls['alma'] + "view/ReprintsDeskCloudApp";
      let authHeader = "Bearer " + data.authToken;
      const headers = new HttpHeaders({ 'Authorization': authHeader});
      let calls = [];      
      selectedRequests.forEach(entity => calls.push(this.http.post<any>(url + "?op=Order_PlaceOrder2&requestId=" + entity.id, [], { headers }).pipe(
        map((res) => {
          console.log(res);
          if(!res.errorMsg){
           this.updatePartner(res, entity.id,res);
          }
         this.requestToOrder.set(res.requestId, res);
         res.status="error"
        }),
        catchError(e => of(e))
      )));
      return forkJoin(calls);
    })).subscribe({
      error: error => {
        console.log(error);
      }, complete: () => this.placeOrderEnded = true
    });
  }
 
 
  onPlaceOrderClicked(event, entityId){
    event.preventDefault();
    event.stopPropagation();
    this.buttonVisibility[entityId] = false;
    this.placeOrderEnded = false;
    let orderObject = new PlaceOrderResponse();
    orderObject.status = "loading";
    this.requestToOrder.set(entityId, orderObject);
    forkJoin({ initData: this.eventsService.getInitData(), authToken: this.eventsService.getAuthToken() }).pipe(concatMap((data) => {
      let url = data.initData.urls['alma']  + "view/ReprintsDeskCloudApp";
      let authHeader = "Bearer " + data.authToken;
      const headers = new HttpHeaders({ 'Authorization': authHeader});
      return this.http.post<any>(url + "?op=Order_PlaceOrder2&requestId=" + entityId, [], { headers });
    })).subscribe({
      next: response => {
        if(!response.errorMsg){
          this.updatePartner(response, entityId, response);
         }
        orderObject.errorMsg=response.errorMsg;  
        response.status = "error";
        this.requestToOrder.set(response.requestId, response);
      }, error: error => {
        console.log(error);
      }
    });
  }
 
updatePartner(placeOrderResponse : PlaceOrderResponse, entityId,response?){
    let requestObject = this.requestIdToRequest.get(entityId);
    let updateUrl = "/rapido/v1/user/" + requestObject.requester.value + "/resource-sharing-requests/" + placeOrderResponse.requestId + "?op=assign_request_to_partner&partner="+this.partnerCode+"&partner_request_id=" + placeOrderResponse.additionalId + "&partner_additional_id=" + placeOrderResponse.randomNumber;
    let priceObject = this.requestToPrice.get(placeOrderResponse.requestId);
    if(priceObject && priceObject.price){
      updateUrl += "&cost=" + priceObject.price;
    }
    let request : Request = {
    url: updateUrl,
    method: HttpMethod.POST
    };
    this.restService.call(request).subscribe({
      error: error => {
        console.log(error);
        placeOrderResponse.errorMsg=`The request was successfully submitted but was not updated in Rapido - error from API.External id:${placeOrderResponse.additionalId},additional id:${placeOrderResponse.randomNumber}`
       //this.buttonVisibility[entityId] = false;
       response.status="error"
        this.placeOrderEnded = true;
      }, complete: () => {this.placeOrderEnded = true; response.status="done"}
    });
  }
 
getEntityAuthor(entityId){
    let requestObject = this.requestIdToRequest.get(entityId);
    if(requestObject && requestObject.author){
      return requestObject.author;
    }
    return "";
  }
 
getEntityJournalTitle(entityId){
    let requestObject = this.requestIdToRequest.get(entityId);
    if(requestObject && requestObject.journal_title){
      return requestObject.journal_title;
    }
    return "";
  }
 
getEntityPublication(entityId){
    let requestObject = this.requestIdToRequest.get(entityId);
    if(requestObject && requestObject.year){
      return requestObject.year;
    }
    return "";
  }
 
getEntityPages(entityId){
    let requestObject = this.requestIdToRequest.get(entityId);
    if(requestObject && requestObject.pages){
      return requestObject.pages;
    }
    return "";
  }
 
getEntityPrice(entityId){
    let priceObject = this.requestToPrice.get(entityId);
    if(priceObject && priceObject.price){
      if(priceObject.price.length == 4){
        return priceObject.price + '0';
      }
      return priceObject.price;
    }
    return "-1";
  }
 
getEntityPriceErrorMsg(entityId){
    let priceObject = this.requestToPrice.get(entityId);
    if(priceObject && priceObject.errorMsg){
      return priceObject.errorMsg;
    }
    return "failed to calculate price";
  }
 
hasPriceErrorMsg(entityId){
    let priceObject = this.requestToPrice.get(entityId);
    if(priceObject && priceObject.errorMsg){
      return true;
    }
    return false;
  }
 
getEntityOrderSuccess(entityId){
    let orderObject = this.requestToOrder.get(entityId);
    if(orderObject && !orderObject.errorMsg){
      return true;
    }
    return false;
  }
 
getEntityOrderStatus(entityId){
    let orderObject = this.requestToOrder.get(entityId);
    if(orderObject && orderObject.status){
      return orderObject.status;
    }
    return "";
  }
 
getEntityOrderErrorMsg(entityId){
    let orderObject = this.requestToOrder.get(entityId);
    if(orderObject && orderObject.errorMsg){
      return orderObject.errorMsg;
    }
    return "faild to place order";
  }
 
 onSelectAllClicked(){
    this.requests.options.forEach(request => {
      if(this.isEnabled(request.value.id)){
        request.selected = true;
      }
    });
  }
 
onSelectedChanged($event: MatSelectionListChange) {
    if(!this.isEnabled($event.option.value.id)){
      event.preventDefault();
      event.stopPropagation();
      $event.option.selected = false;
    }
  }
 
isEnabled(requestId){
    let price = this.getEntityPrice(requestId);
    if(price && price != "-1"){
      return true;
    }
    return false;
  }
 
getShowSubmitSpinner(entityId){
    let orderObject = this.requestToOrder.get(entityId);
    if(orderObject && orderObject.status == "loading"){
      return true;
    }
    return false;
  }
 
}
 
const isRestErrorResponse = (object: any): object is RestErrorResponse => 'error' in object;